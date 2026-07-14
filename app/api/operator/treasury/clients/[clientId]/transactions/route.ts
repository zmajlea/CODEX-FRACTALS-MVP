import { NextResponse } from "next/server";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

type RouteContext = { params: Promise<{ clientId: string }> };

function escapeIlike(q: string): string {
  return q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/,/g, "\\,");
}

function parseAccountIds(url: URL): string[] {
  const raw = url.searchParams.getAll("account_id");
  return raw
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  if (!cursor) {
    await writeOperatorTreasuryReadAudit(guard.admin, {
      actorUserId: guard.user.id,
      clientUserId: clientId,
      tenantId: guard.grant.tenantId,
      grantId: guard.grant.grantId,
      surface: "transactions",
    });
  }

  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const accountIds = parseAccountIds(url);
  const label = url.searchParams.get("label") ?? undefined;
  const labeled = url.searchParams.get("labeled");
  const q = url.searchParams.get("q") ?? undefined;
  const amountMinRaw = url.searchParams.get("amount_min");
  const amountMaxRaw = url.searchParams.get("amount_max");
  const amountExactRaw = url.searchParams.get("amount_exact");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);

  let query = guard.admin
    .from("treasury_transactions")
    .select("*")
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .order("posted_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (from) query = query.gte("posted_date", from);
  if (to) query = query.lte("posted_date", to);
  if (accountIds.length) query = query.in("account_id", accountIds);
  if (label) query = query.eq("label", label);
  if (labeled === "true") query = query.not("label", "is", null);
  if (labeled === "false") query = query.is("label", null);
  if (q) {
    const safe = escapeIlike(q);
    query = query.or(
      `raw_name.ilike.%${safe}%,merchant_name.ilike.%${safe}%,description.ilike.%${safe}%`
    );
  }

  if (amountExactRaw != null && amountExactRaw !== "") {
    const x = Number(amountExactRaw);
    if (!Number.isFinite(x) || x < 0) {
      return NextResponse.json({ error: "Invalid amount_exact" }, { status: 400 });
    }
    query = query.or(`amount.eq.${x},amount.eq.${-x}`);
  } else if (amountMinRaw != null || amountMaxRaw != null) {
    const min = Number(amountMinRaw ?? amountMaxRaw);
    const max = Number(amountMaxRaw ?? amountMinRaw);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) {
      return NextResponse.json({ error: "Invalid amount range" }, { status: 400 });
    }
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    query = query.or(
      `and(amount.gte.${lo},amount.lte.${hi}),and(amount.gte.${-hi},amount.lte.${-lo})`
    );
  }

  if (cursor) {
    const [cursorDate, cursorId] = cursor.split("|");
    if (cursorDate && cursorId) {
      query = query.or(
        `posted_date.lt.${cursorDate},and(posted_date.eq.${cursorDate},id.lt.${cursorId})`
      );
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("[operator/treasury/transactions]", error);
    return NextResponse.json({ error: "Failed to load transactions" }, { status: 500 });
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.posted_date}|${last.id}` : null;

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

  const transactions = page.map((tx) => ({
    ...tx,
    account: accountMap.get(tx.account_id) ?? {
      name: null,
      mask: null,
      institution_name: null,
    },
  }));

  const { count: needsLabel } = await guard.admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .eq("pending", false)
    .is("label", null);

  const { count: pendingCount } = await guard.admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .eq("pending", true);

  return NextResponse.json({
    transactions,
    nextCursor,
    needsLabelCount: needsLabel ?? 0,
    pendingCount: pendingCount ?? 0,
  });
}
