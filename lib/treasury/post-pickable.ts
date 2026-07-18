/** Client helper — POST a Pickable (or bulk tx ids) into an open draft. */

import type { DraftKind, Pickable } from "@/lib/treasury/pickable";

export type PostPickResult = {
  duplicate: boolean;
  draftId?: string;
};

/** Exported for gate — null/undefined JSON must not throw on `.duplicate`. */
export function parsePickBody(raw: unknown): {
  error?: string;
  duplicate: boolean;
  draftId?: string;
} {
  const body =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const draft =
    body.draft && typeof body.draft === "object"
      ? (body.draft as { id?: string })
      : undefined;
  return {
    error: typeof body.error === "string" ? body.error : undefined,
    duplicate: Boolean(body?.duplicate),
    draftId: typeof draft?.id === "string" ? draft.id : undefined,
  };
}

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
  const parsed = parsePickBody(await res.json().catch(() => ({})));
  if (!res.ok) {
    throw new Error(parsed.error ?? "Failed to add to draft");
  }
  return {
    duplicate: parsed.duplicate,
    draftId: parsed.draftId,
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
  const parsed = parsePickBody(await res.json().catch(() => ({})));
  if (!res.ok) {
    throw new Error(parsed.error ?? "Failed to add to draft");
  }
  return {
    duplicate: parsed.duplicate,
    draftId: parsed.draftId,
  };
}
