import { NextResponse } from "next/server";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  applyTxPredicate,
  withStatus,
  type TxFilterInput,
  type TxStatusFilter,
} from "@/lib/treasury/tx-predicate";

type RouteContext = { params: Promise<{ clientId: string }> };

function parseAccountIds(url: URL): string[] {
  const raw = url.searchParams.getAll("account_id");
  return raw
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseFilters(url: URL): TxFilterInput {
  const amountMinRaw = url.searchParams.get("amount_min");
  const amountMaxRaw = url.searchParams.get("amount_max");
  const amountExactRaw = url.searchParams.get("amount_exact");
  const ruleQueue = url.searchParams.get("rule_queue");
  return {
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    status: (url.searchParams.get("status") as TxStatusFilter | null) ?? undefined,
    labeled: url.searchParams.get("labeled"),
    q: url.searchParams.get("q") || undefined,
    accountIds: parseAccountIds(url),
    amountExact:
      amountExactRaw != null && amountExactRaw !== ""
        ? Number(amountExactRaw)
        : null,
    amountMin:
      amountMinRaw != null && amountMinRaw !== "" ? Number(amountMinRaw) : null,
    amountMax:
      amountMaxRaw != null && amountMaxRaw !== "" ? Number(amountMaxRaw) : null,
    ruleId: url.searchParams.get("rule_id") || undefined,
    ruleQueue:
      ruleQueue === "suggested" ||
      ruleQueue === "confirmed" ||
      ruleQueue === "rejected"
        ? ruleQueue
        : undefined,
  };
}

export async function GET(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const url = new URL(request.url);
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0));
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  if (!cursor && page === 0) {
    await writeOperatorTreasuryReadAudit(guard.admin, {
      actorUserId: guard.user.id,
      clientUserId: clientId,
      tenantId: guard.grant.tenantId,
      grantId: guard.grant.grantId,
      surface: "transactions",
    });
  }

  const filters = parseFilters(url);

  if (filters.amountExact != null && (!Number.isFinite(filters.amountExact) || filters.amountExact < 0)) {
    return NextResponse.json({ error: "Invalid amount_exact" }, { status: 400 });
  }
  if (
    (filters.amountMin != null || filters.amountMax != null) &&
    filters.amountExact == null
  ) {
    const min = filters.amountMin ?? filters.amountMax;
    const max = filters.amountMax ?? filters.amountMin;
    if (
      min == null ||
      max == null ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min < 0 ||
      max < 0
    ) {
      return NextResponse.json({ error: "Invalid amount range" }, { status: 400 });
    }
  }

  const base = () =>
    applyTxPredicate(
      guard.admin
        .from("treasury_transactions")
        .select("*")
        .eq("client_user_id", clientId)
        .eq("is_removed", false),
      filters
    );

  const offset = page * limit;
  let query = base()
    .order("posted_date", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  // Legacy cursor support
  if (cursor) {
    const [cursorDate, cursorId] = cursor.split("|");
    if (cursorDate && cursorId) {
      query = applyTxPredicate(
        guard.admin
          .from("treasury_transactions")
          .select("*")
          .eq("client_user_id", clientId)
          .eq("is_removed", false),
        filters
      )
        .order("posted_date", { ascending: false })
        .order("id", { ascending: false })
        .or(
          `posted_date.lt.${cursorDate},and(posted_date.eq.${cursorDate},id.lt.${cursorId})`
        )
        .limit(limit + 1);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("[operator/treasury/transactions]", error);
    return NextResponse.json({ error: "Failed to load transactions" }, { status: 500 });
  }

  const rows = data ?? [];
  const hasMore = cursor ? rows.length > limit : false;
  const pageRows = cursor && hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    cursor && hasMore && last ? `${last.posted_date}|${last.id}` : null;

  const { data: accountRows } = await guard.admin
    .from("treasury_accounts")
    .select("account_id, name, mask, plaid_item_id, source")
    .eq("client_user_id", clientId);

  const itemIds = [
    ...new Set(
      (accountRows ?? [])
        .map((a) => a.plaid_item_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const institutionByItem = new Map<string, string | null>();
  if (itemIds.length) {
    const { data: items } = await guard.admin
      .from("plaid_items")
      .select("id, institution_name")
      .in("id", itemIds);
    for (const item of items ?? []) {
      institutionByItem.set(item.id, item.institution_name);
    }
  }

  const accountMap = new Map<
    string,
    { name: string | null; mask: string | null; institution_name: string | null }
  >();
  for (const acct of accountRows ?? []) {
    const institutionName =
      acct.source === "csv" || !acct.plaid_item_id
        ? "CSV import"
        : (institutionByItem.get(acct.plaid_item_id) ?? "Bank");
    accountMap.set(acct.account_id, {
      name: acct.name,
      mask: acct.mask,
      institution_name: institutionName,
    });
  }

  const transactions = pageRows.map((tx) => ({
    ...tx,
    account: accountMap.get(tx.account_id) ?? {
      name: null,
      mask: null,
      institution_name: null,
    },
  }));

  const countHead = (f: TxFilterInput) =>
    applyTxPredicate(
      guard.admin
        .from("treasury_transactions")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", clientId)
        .eq("is_removed", false),
      f
    );

  const filtersSansStatus: TxFilterInput = {
    ...filters,
    status: "all",
    labeled: null,
    ruleId: filters.ruleId,
    ruleQueue: filters.ruleQueue,
  };

  // Status chips share other filters; when in rule queue mode, skip chip counts.
  const chipBase: TxFilterInput = filters.ruleId
    ? filtersSansStatus
    : { ...filtersSansStatus, ruleId: null, ruleQueue: null };

  const [
    { count: filteredTotal },
    { count: needsLabel },
    { count: suggestedTotal },
    { count: labeledTotal },
    { count: pendingCount },
    bookCountRes,
    bookFirstRes,
    bookLastRes,
    bookImportRes,
  ] = await Promise.all([
    countHead(filters),
    filters.ruleId
      ? Promise.resolve({ count: 0 })
      : countHead(withStatus(chipBase, "needs_label")),
    filters.ruleId
      ? Promise.resolve({ count: 0 })
      : countHead(withStatus(chipBase, "suggested")),
    filters.ruleId
      ? Promise.resolve({ count: 0 })
      : countHead(withStatus(chipBase, "labeled")),
    guard.admin
      .from("treasury_transactions")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientId)
      .eq("is_removed", false)
      .eq("pending", true),
    guard.admin
      .from("treasury_transactions")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientId)
      .eq("is_removed", false),
    guard.admin
      .from("treasury_transactions")
      .select("posted_date")
      .eq("client_user_id", clientId)
      .eq("is_removed", false)
      .not("posted_date", "is", null)
      .order("posted_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    guard.admin
      .from("treasury_transactions")
      .select("posted_date")
      .eq("client_user_id", clientId)
      .eq("is_removed", false)
      .not("posted_date", "is", null)
      .order("posted_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    guard.admin
      .from("treasury_transactions")
      .select("created_at")
      .eq("client_user_id", clientId)
      .eq("is_removed", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    transactions,
    nextCursor,
    total: filteredTotal ?? 0,
    page,
    limit,
    book: {
      count: bookCountRes.count ?? 0,
      first: bookFirstRes.data?.posted_date ?? null,
      last: bookLastRes.data?.posted_date ?? null,
      importedAt: bookImportRes.data?.created_at ?? null,
    },
    needsLabelCount: needsLabel ?? 0,
    suggestedCount: suggestedTotal ?? 0,
    labeledCount: labeledTotal ?? 0,
    pendingCount: pendingCount ?? 0,
  });
}
