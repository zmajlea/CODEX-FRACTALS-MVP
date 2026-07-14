import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecommendationStatus } from "@/lib/treasury/recommendation-status";
import type {
  TreasuryRecommendationAnchorRef,
  TreasuryRecommendationRow,
  TreasuryRecommendationRollup,
  TreasuryInboxItem,
} from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export function computeRecommendationRollup(
  rows: Pick<TreasuryRecommendationRow, "status">[]
): TreasuryRecommendationRollup {
  const rollup: TreasuryRecommendationRollup = {
    awaiting: 0,
    accepted: 0,
    in_progress: 0,
    done: 0,
    declined: 0,
    draft: 0,
  };
  for (const row of rows) {
    const s = row.status as RecommendationStatus;
    if (s === "sent") rollup.awaiting += 1;
    else if (s === "accepted") rollup.accepted += 1;
    else if (s === "in_progress") rollup.in_progress += 1;
    else if (s === "done") rollup.done += 1;
    else if (s === "declined") rollup.declined += 1;
    else if (s === "draft") rollup.draft += 1;
  }
  return rollup;
}

export async function verifyRecommendationAnchor(
  admin: AdminClient,
  clientUserId: string,
  accountId: string
): Promise<TreasuryRecommendationAnchorRef | null> {
  const { data, error } = await admin
    .from("treasury_accounts")
    .select("account_id, name, mask")
    .eq("client_user_id", clientUserId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    account_id: data.account_id,
    name: data.name,
    mask: data.mask,
  };
}

export function operatorUnreadCount(rows: TreasuryRecommendationRow[]): number {
  return rows.filter(
    (r) =>
      (r.status === "accepted" || r.status === "declined") && r.operator_seen_at == null
  ).length;
}

export function clientUnreadCount(rows: TreasuryRecommendationRow[]): number {
  return rows.filter((r) => {
    if (r.status !== "sent") return false;
    if (!r.client_seen_at) return true;
    if (!r.sent_at) return true;
    return new Date(r.sent_at) > new Date(r.client_seen_at);
  }).length;
}

export type { TreasuryInboxItem } from "@/lib/treasury/types";

export function buildOperatorInboxItems(
  rows: TreasuryRecommendationRow[],
  clientNames: Map<string, string>
): TreasuryInboxItem[] {
  const items: TreasuryInboxItem[] = [];

  for (const row of rows) {
    const clientName = clientNames.get(row.client_user_id) ?? "Client";

    if (row.status === "accepted") {
      items.push({
        id: `${row.id}-accepted`,
        recommendationId: row.id,
        clientUserId: row.client_user_id,
        clientName,
        kind: "Accepted",
        title: `${clientName} accepted: ${row.title}`,
        sub: "Begin the work",
        unread: row.operator_seen_at == null,
        actioned: false,
        updatedAt: row.decided_at ?? row.updated_at,
      });
    } else if (row.status === "declined") {
      items.push({
        id: `${row.id}-declined`,
        recommendationId: row.id,
        clientUserId: row.client_user_id,
        clientName,
        kind: "Declined",
        title: `${clientName} declined: ${row.title}`,
        sub: row.decline_reason,
        unread: row.operator_seen_at == null,
        actioned: false,
        updatedAt: row.decided_at ?? row.updated_at,
      });
    } else if (row.status === "in_progress" || row.status === "done") {
      items.push({
        id: `${row.id}-${row.status}`,
        recommendationId: row.id,
        clientUserId: row.client_user_id,
        clientName,
        kind: "Progress",
        title: row.title,
        sub: row.status === "in_progress" ? "Marked in progress" : "Marked done",
        unread: false,
        actioned: true,
        updatedAt: row.updated_at,
      });
    }
  }

  return items.sort((a, b) => {
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function inboxUnreadCount(items: TreasuryInboxItem[]): number {
  return items.filter((i) => i.unread).length;
}
