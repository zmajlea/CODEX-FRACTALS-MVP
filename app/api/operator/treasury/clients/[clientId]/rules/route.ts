import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { applyRulesForClient, countRuleQueues } from "@/lib/server/treasury-rules";
import type { Database } from "@/lib/database.types";
import type { TreasuryRuleRow } from "@/lib/treasury/types";

type RouteContext = { params: Promise<{ clientId: string }> };
type AdminClient = SupabaseClient<Database>;

export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data, error } = await guard.admin
    .from("treasury_rules")
    .select("*")
    .eq("client_user_id", clientId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ruleRows = (data ?? []) as TreasuryRuleRow[];
  const queueCounts = await countRuleQueues(guard.admin, clientId, ruleRows);

  return NextResponse.json({
    rules: ruleRows.map((rule) => {
      const q = queueCounts.get(rule.id) ?? { suggested: 0, confirmed: 0 };
      return {
        ...rule,
        suggested_count: q.suggested,
        confirmed_count: q.confirmed,
        // Legacy field = sum (do not use for UI — Spec 36)
        matched_count: q.suggested + q.confirmed,
      };
    }),
  });
}

type PostBody = {
  name?: string;
  match_merchant?: string;
  match_type?: "exact" | "contains" | "fuzzy";
  amount_min?: number | null;
  amount_max?: number | null;
  direction?: "in" | "out" | null;
  assign_label?: string;
  source_transaction_id?: string | null;
};

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "23505" ||
    /duplicate key|unique constraint|treasury_rules_dedup/i.test(error.message ?? "")
  );
}

async function findActiveDuplicate(
  admin: AdminClient,
  clientId: string,
  matchMerchant: string,
  assignLabel: string,
  matchType: string
): Promise<TreasuryRuleRow | null> {
  const { data, error } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("client_user_id", clientId)
    .eq("active", true)
    .eq("match_merchant", matchMerchant)
    .eq("assign_label", assignLabel)
    .eq("match_type", matchType)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as TreasuryRuleRow | null) ?? null;
}

export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim() || !body.match_merchant?.trim() || !body.assign_label?.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const matchMerchant = body.match_merchant.trim();
  const assignLabel = body.assign_label.trim();
  const matchType = body.match_type ?? "contains";

  // Spec 55 A2 — reuse existing active duplicate; do not re-apply (counts stay stable).
  try {
    const existing = await findActiveDuplicate(
      guard.admin,
      clientId,
      matchMerchant,
      assignLabel,
      matchType
    );
    if (existing) {
      return NextResponse.json({ rule: existing, suggested: 0, existed: true });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data: rule, error } = await guard.admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: guard.user.id,
      name: body.name.trim(),
      match_merchant: matchMerchant,
      match_type: matchType,
      amount_min: body.amount_min ?? null,
      amount_max: body.amount_max ?? null,
      direction: body.direction ?? null,
      assign_label: assignLabel,
      source_transaction_id: body.source_transaction_id ?? null,
      active: true,
    })
    .select("*")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      try {
        const existing = await findActiveDuplicate(
          guard.admin,
          clientId,
          matchMerchant,
          assignLabel,
          matchType
        );
        if (existing) {
          return NextResponse.json({ rule: existing, suggested: 0, existed: true });
        }
      } catch {
        /* fall through */
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const suggested = await applyRulesForClient(guard.admin, clientId, rule.id);
  return NextResponse.json({ rule, suggested, existed: false });
}
