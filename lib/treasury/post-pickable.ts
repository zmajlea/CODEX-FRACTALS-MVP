/** Client helper — POST a Pickable into an open draft. */

import type { DraftKind, Pickable } from "@/lib/treasury/pickable";

export async function postPickableToDraft(
  clientUserId: string,
  draftKind: DraftKind,
  pickable: Pickable
): Promise<void> {
  const res = await fetch(
    `/api/operator/treasury/clients/${clientUserId}/recommendations/draft/evidence`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_kind: draftKind, pickable }),
    }
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to add to draft");
  }
}
