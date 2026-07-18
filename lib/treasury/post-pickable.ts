/** Client helper — POST a Pickable (or bulk tx ids) into an open draft. */

import type { DraftKind, Pickable } from "@/lib/treasury/pickable";

export type PostPickResult = {
  duplicate: boolean;
  draftId?: string;
};

export async function postPickableToDraft(
  clientUserId: string,
  draftKind: DraftKind,
  pickable: Pickable
): Promise<PostPickResult> {
  const res = await fetch(
    `/api/operator/treasury/clients/${clientUserId}/recommendations/draft/evidence`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_kind: draftKind, pickable }),
    }
  );
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    duplicate?: boolean;
    draft?: { id?: string };
  };
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to add to draft");
  }
  return {
    duplicate: Boolean(body.duplicate),
    draftId: body.draft?.id,
  };
}

export async function postTransactionIdsToDraft(
  clientUserId: string,
  draftKind: DraftKind,
  transactionIds: string[]
): Promise<PostPickResult> {
  const res = await fetch(
    `/api/operator/treasury/clients/${clientUserId}/recommendations/draft/evidence`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draft_kind: draftKind,
        transaction_ids: transactionIds,
      }),
    }
  );
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    duplicate?: boolean;
    draft?: { id?: string };
  };
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to add to draft");
  }
  return {
    duplicate: Boolean(body.duplicate),
    draftId: body.draft?.id,
  };
}
