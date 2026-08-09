import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  applyTxPredicate,
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
  const directionRaw = url.searchParams.get("direction");
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
    direction:
      directionRaw === "in" || directionRaw === "out" ? directionRaw : null,
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
    // Spec 67 C — non-blocking audit (don't hold the response)
    void writeOperatorTreasuryReadAudit(guard.admin, {
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

  const offset = page * limit;
  let pageQuery = base()
    .order("posted_date", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  // Legacy cursor support
  if (cursor) {
    const [cursorDate, cursorId] = cursor.split("|");
    if (cursorDate && cursorId) {
      pageQuery = base()
        .order("posted_date", { ascending: false })
        .order("id", { ascending: false })
        .or(
          `posted_date.lt.${cursorDate},and(posted_date.eq.${cursorDate},id.lt.${cursorId})`
        )
        .limit(limit + 1);
    }
  }

  const filtersSansStatus: TxFilterInput = {
    ...listFilters,
    status: "all",
    labeled: null,
    ruleId: null,
    ruleQueue: null,
  };
  const chipBase: TxFilterInput = { ...filtersSansStatus };

  const amountMin =
    chipBase.amountExact == null &&
    (chipBase.amountMin != null || chipBase.amountMax != null)
      ? Math.abs(Number(chipBase.amountMin ?? chipBase.amountMax))
      : null;
  const amountMax =
    chipBase.amountExact == null &&
    (chipBase.amountMin != null || chipBase.amountMax != null)
      ? Math.abs(Number(chipBase.amountMax ?? chipBase.amountMin))
      : null;

  // Spec 67 B2/C — page + accounts + chip/book meta in parallel
  const [pageRes, accountsRes, filteredTotalRes, chipRes] = await Promise.all([
    pageQuery,
    guard.admin
      .from("treasury_accounts")
      .select("account_id, name, mask, plaid_item_id, source")
      .eq("client_user_id", clientId),
    comboTotal != null
      ? Promise.resolve({ count: comboTotal, error: null })
      : countHead(listFilters, filters),
    guard.admin.rpc("treasury_tx_chip_counts", {
      p_client: clientId,
      p_from: chipBase.from ?? null,
      p_to: chipBase.to ?? null,
      p_account_ids:
        chipBase.accountIds && chipBase.accountIds.length > 0
          ? chipBase.accountIds
          : null,
      p_q: chipBase.q ?? null,
      p_direction: chipBase.direction ?? null,
      p_amount_min: amountMin,
      p_amount_max: amountMax,
      p_amount_exact:
        chipBase.amountExact != null ? Math.abs(chipBase.amountExact) : null,
    }),
  ]);

  const { data, error } = pageRes;
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

  const accountRows = accountsRes.data ?? [];
  const itemIds = [
    ...new Set(
      accountRows
        .map((a) => a.plaid_item_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const pageIds = pageRows.map((t) => t.id);

  const [itemsRes, sugRes] = await Promise.all([
    itemIds.length
      ? guard.admin
          .from("plaid_items")
          .select("id, institution_name")
          .in("id", itemIds)
      : Promise.resolve({ data: [] as Array<{ id: string; institution_name: string | null }> }),
    pageIds.length > 0
      ? guard.admin
          .from("treasury_transaction_suggestions")
          .select(
            "transaction_id, rule_id, suggested_label, suggestion_explanation, treasury_rules(name, match_merchant)"
          )
          .in("transaction_id", pageIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const institutionByItem = new Map<string, string | null>();
  for (const item of itemsRes.data ?? []) {
    institutionByItem.set(item.id, item.institution_name);
  }

  const accountMap = new Map<
    string,
    { name: string | null; mask: string | null; institution_name: string | null }
  >();
  for (const acct of accountRows) {
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
  for (const s of (sugRes.data ?? []) as Array<{
    transaction_id: string;
    rule_id: string;
    suggested_label: string;
    suggestion_explanation: string | null;
    treasury_rules:
      | { name: string; match_merchant: string }
      | { name: string; match_merchant: string }[]
      | null;
  }>) {
    const rule = s.treasury_rules;
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

  const chips = (chipRes.data ?? {}) as {
    needs_label?: number;
    suggested?: number;
    labeled?: number;
    pending?: number;
    book_count?: number;
    book_first?: string | null;
    book_last?: string | null;
    book_imported_at?: string | null;
  };
  if (chipRes.error) {
    console.error("[operator/treasury/transactions] chip_counts", chipRes.error);
  }

  const filteredTotal = filteredTotalRes.count;
  // Match prior behaviour: status chips zeroed while in a rule-queue view
  const hideStatusChips = Boolean(filters.ruleId);

  return NextResponse.json({
    transactions,
    nextCursor,
    total: filteredTotal ?? 0,
    page,
    limit,
    book: {
      count: chips.book_count ?? 0,
      first: chips.book_first ?? null,
      last: chips.book_last ?? null,
      importedAt: chips.book_imported_at ?? null,
    },
    needsLabelCount: hideStatusChips ? 0 : (chips.needs_label ?? 0),
    suggestedCount: hideStatusChips ? 0 : (chips.suggested ?? 0),
    labeledCount: hideStatusChips ? 0 : (chips.labeled ?? 0),
    pendingCount: chips.pending ?? 0,
  });
}
