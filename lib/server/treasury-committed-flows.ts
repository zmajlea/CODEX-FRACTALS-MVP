import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";
import { subtractDays, todayIso } from "@/lib/treasury/period-bounds";
import {
  detectCommittedFlows,
  type CommittedFlowLine,
} from "@/lib/treasury/committed-flows";
import type { TreasuryRuleRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

const LOOKBACK_DAYS = 180;

export async function loadCommittedFlows(
  admin: AdminClient,
  clientUserId: string,
  accountId: string,
  opts?: { asOf?: string; horizonDays?: number }
): Promise<{ asOf: string; lines: CommittedFlowLine[] }> {
  const asOf = (opts?.asOf ?? todayIso()).slice(0, 10);
  const lookbackFrom = subtractDays(asOf, LOOKBACK_DAYS);

  const txs = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transactions")
      .select(
        "posted_date,amount,direction,normalized_merchant,raw_name,merchant_name,label"
      )
      .eq("client_user_id", clientUserId)
      .eq("account_id", accountId)
      .eq("is_removed", false)
      .eq("pending", false)
      .gte("posted_date", lookbackFrom)
      .lte("posted_date", asOf)
      .order("posted_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );

  const { data: rulesData } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("active", true);

  const rules = (rulesData ?? []) as TreasuryRuleRow[];

  const lines = detectCommittedFlows(txs, rules, {
    asOf,
    horizonDays: opts?.horizonDays ?? 30,
    lookbackDays: LOOKBACK_DAYS,
  });

  return { asOf, lines };
}
