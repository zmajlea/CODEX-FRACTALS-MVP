import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
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
  const comboParts = url.searchParams
    .getAll("combo")
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  const combo =
    comboParts.length > 0
      ? [...new Set(comboParts)].sort((a, b) => a.localeCompare(b))
      : null;
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
    combo,
  };
}

/**
 * Spec 60 — rule-queue suggested/rejected via PostgREST !inner join.
 * Never .in("id", hugeIdArray) — that blows the URL limit on large rules (~546).
 */
function ruleQueueSelect(filters: TxFilterInput): string {
  if (filters.ruleId && filters.ruleQueue === "suggested") {
    return "*, treasury_transaction_suggestions!inner(rule_id)";
  }
  if (filters.ruleId && filters.ruleQueue === "rejected") {
    return "*, treasury_rule_rejections!inner(rule_id)";
  }
  return "*";
}

function ruleQueueCountSelect(filters: TxFilterInput): string {
  if (filters.ruleId && filters.ruleQueue === "suggested") {
    return "id, treasury_transaction_suggestions!inner(rule_id)";
  }
  if (filters.ruleId && filters.ruleQueue === "rejected") {
    return "id, treasury_rule_rejections!inner(rule_id)";
  }
  return "id";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyRuleQueueJoin(q: any, filters: TxFilterInput) {
  if (filters.ruleId && filters.ruleQueue === "suggested") {
    return q
      .eq("treasury_transaction_suggestions.rule_id", filters.ruleId)
      .is("label", null);
  }
  if (filters.ruleId && filters.ruleQueue === "rejected") {
    return q.eq("treasury_rule_rejections.rule_id", filters.ruleId);
  }
  return q;
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

  // Predicate filters without the rule-queue join (join applied separately).
  // Confirmed queue still uses suggested_by_rule_id on the tx row.
  const listFilters: TxFilterInput =
    filters.ruleId && filters.ruleQueue === "suggested"
      ? {
          ...filters,
          ruleId: null,
          ruleQueue: null,
          status: "all",
          labeled: null,
          combo: null,
        }
      : filters.ruleId && filters.ruleQueue === "rejected"
        ? {
            ...filters,
            ruleId: null,
            ruleQueue: null,
            status: "all",
            labeled: null,
            combo: null,
          }
        : filters;

  // Spec 61 — combo filter: page-sized ids from SQL (never full-bucket .in)
  let comboPageIds: string[] | null = null;
  let comboTotal: number | null = null;
  if (
    filters.ruleId &&
    filters.ruleQueue === "suggested" &&
    filters.combo &&
    filters.combo.length > 0
  ) {
    const { data: pageJson, error: comboErr } = await guard.admin.rpc(
      "treasury_rule_queue_combo_page",
      {
        p_client: clientId,
        p_rule: filters.ruleId,
        p_combo: filters.combo,
        p_offset: page * limit,
        p_limit: limit,
      }
    );
    if (comboErr) {
      console.error("[operator/treasury/transactions] combo_page", comboErr);
      return NextResponse.json({ error: "Failed to filter combo" }, { status: 500 });
    }
    const parsed = pageJson as { total?: number; ids?: string[] } | null;
    comboTotal = parsed?.total ?? 0;
    comboPageIds = parsed?.ids ?? [];
  }

  const base = () => {
    let q = applyTxPredicate(
      guard.admin
        .from("treasury_transactions")
        .select(
          comboPageIds
            ? "*"
            : ruleQueueSelect(filters)
        )
        .eq("client_user_id", clientId)
        .eq("is_removed", false),
      listFilters
    );
    if (comboPageIds) {
      if (comboPageIds.length === 0) {
        q = q.eq("id", "00000000-0000-0000-0000-000000000000");
      } else {
        q = q.in("id", comboPageIds);
      }
    } else {
      q = applyRuleQueueJoin(q, filters);
    }
    return q;
  };

  const offset = page * limit;
  let query = base()
    .order("posted_date", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  // Legacy cursor support
  if (cursor) {
    const [cursorDate, cursorId] = cursor.split("|");
    if (cursorDate && cursorId) {
      query = base()
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

  type TxListRow = Database["public"]["Tables"]["treasury_transactions"]["Row"] & {
    treasury_transaction_suggestions?: unknown;
    treasury_rule_rejections?: unknown;
  };

  let rows = (data ?? []) as unknown as TxListRow[];
  // Preserve combo-page SQL order (PostgREST .in does not)
  if (comboPageIds && comboPageIds.length > 0) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    rows = comboPageIds
      .map((id) => byId.get(id))
      .filter((r): r is TxListRow => Boolean(r));
  }
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

  // Spec 58 — embed pending suggestions (+ rule name) for the page
  const pageIds = pageRows.map((t) => t.id);
  const suggestionsByTx = new Map<
    string,
    Array<{
      rule_id: string;
      suggested_label: string;
      suggestion_explanation: string | null;
      rule_name: string | null;
      match_merchant: string | null;
    }>
  >();
  if (pageIds.length > 0) {
    const { data: sugRows } = await guard.admin
      .from("treasury_transaction_suggestions")
      .select(
        "transaction_id, rule_id, suggested_label, suggestion_explanation, treasury_rules(name, match_merchant)"
      )
      .in("transaction_id", pageIds);
    for (const s of sugRows ?? []) {
      const rule = s.treasury_rules as
        | { name: string; match_merchant: string }
        | { name: string; match_merchant: string }[]
        | null;
      const ruleObj = Array.isArray(rule) ? rule[0] : rule;
      const list = suggestionsByTx.get(s.transaction_id) ?? [];
      list.push({
        rule_id: s.rule_id,
        suggested_label: s.suggested_label,
        suggestion_explanation: s.suggestion_explanation,
        rule_name: ruleObj?.name ?? null,
        match_merchant: ruleObj?.match_merchant ?? null,
      });
      suggestionsByTx.set(s.transaction_id, list);
    }
  }

  const transactions = pageRows.map((tx) => {
    const {
      treasury_transaction_suggestions: _sugJoin,
      treasury_rule_rejections: _rejJoin,
      ...rest
    } = tx;
    return {
      ...rest,
      account: accountMap.get(tx.account_id) ?? {
        name: null,
        mask: null,
        institution_name: null,
      },
      suggestions: suggestionsByTx.get(tx.id) ?? [],
    };
  });

  const countHead = (f: TxFilterInput, queueFilters?: TxFilterInput) => {
    const qf = queueFilters ?? f;
    let q = applyTxPredicate(
      guard.admin
        .from("treasury_transactions")
        .select(ruleQueueCountSelect(qf), { count: "exact", head: true })
        .eq("client_user_id", clientId)
        .eq("is_removed", false),
      f
    );
    q = applyRuleQueueJoin(q, qf);
    return q;
  };

  const filtersSansStatus: TxFilterInput = {
    ...listFilters,
    status: "all",
    labeled: null,
    ruleId: null,
    ruleQueue: null,
  };

  const chipBase: TxFilterInput = { ...filtersSansStatus };

  const [
    filteredTotalRes,
    { count: needsLabel },
    { count: suggestedTotal },
    { count: labeledTotal },
    { count: pendingCount },
    bookCountRes,
    bookFirstRes,
    bookLastRes,
    bookImportRes,
  ] = await Promise.all([
    comboTotal != null
      ? Promise.resolve({ count: comboTotal })
      : countHead(listFilters, filters),
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

  const filteredTotal = filteredTotalRes.count;

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
