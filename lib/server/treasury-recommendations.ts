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
  rows: Pick<
    TreasuryRecommendationRow,
    | "status"
    | "kind"
    | "client_response"
    | "operator_seen_at"
    | "responded_at"
  >[]
): TreasuryRecommendationRollup {
  const rollup: TreasuryRecommendationRollup = {
    awaiting: 0,
    accepted: 0,
    in_progress: 0,
    answeredReview: 0,
    done: 0,
    declined: 0,
    draft: 0,
  };
  for (const row of rows) {
    const s = row.status as RecommendationStatus;
    if (s === "sent") {
      rollup.awaiting += 1;
      continue;
    }
    if (s === "accepted") {
      rollup.accepted += 1;
      continue;
    }
    if (s === "in_progress") {
      rollup.in_progress += 1;
      continue;
    }
    if (s === "declined") {
      rollup.declined += 1;
      continue;
    }
    if (s === "draft") {
      rollup.draft += 1;
      continue;
    }
    if (s === "done") {
      const answered =
        row.kind === "question" &&
        typeof row.client_response === "string" &&
        row.client_response.trim().length > 0;
      if (answered) {
        const unread =
          row.operator_seen_at == null ||
          (row.responded_at != null &&
            new Date(row.operator_seen_at) < new Date(row.responded_at));
        if (unread) rollup.answeredReview += 1;
        else rollup.done += 1;
      } else {
        rollup.done += 1;
      }
    }
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
  return rows.filter((r) => {
    if (r.operator_seen_at != null) return false;
    if (r.status === "accepted" || r.status === "declined") return true;
    // Question answered → done with responded_at
    if (r.kind === "question" && r.status === "done" && r.responded_at) return true;
    return false;
  }).length;
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
    const isQuestion = row.kind === "question";

    if (isQuestion && row.status === "done" && row.responded_at) {
      items.push({
        id: `${row.id}-answered`,
        recommendationId: row.id,
        clientUserId: row.client_user_id,
        clientName,
        kind: "Answered",
        act: `Answered your question: ${row.title}`,
        snip: row.client_response
          ? `Client answered: ${row.client_response}`
          : "Client answered.",
        unread: row.operator_seen_at == null,
        actioned: false,
        updatedAt: row.responded_at ?? row.updated_at,
      });
      continue;
    }

    if (row.status === "accepted") {
      items.push({
        id: `${row.id}-accepted`,
        recommendationId: row.id,
        clientUserId: row.client_user_id,
        clientName,
        kind: "Accepted",
        act: `Accepted your recommendation: ${row.title}`,
        snip: "Now in progress on the record. Open to see the tracker.",
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
        act: `Declined your recommendation: ${row.title}`,
        snip: null,
        unread: row.operator_seen_at == null,
        actioned: false,
        updatedAt: row.decided_at ?? row.updated_at,
      });
    } else if (
      !isQuestion &&
      (row.status === "in_progress" || row.status === "done")
    ) {
      items.push({
        id: `${row.id}-${row.status}`,
        recommendationId: row.id,
        clientUserId: row.client_user_id,
        clientName,
        kind: "Progress",
        act:
          row.status === "in_progress"
            ? `In progress on your recommendation: ${row.title}`
            : `Completed your recommendation: ${row.title}`,
        snip: null,
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
