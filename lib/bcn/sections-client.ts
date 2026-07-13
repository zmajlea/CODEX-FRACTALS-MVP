import type { BcnSectionPayload } from "@/lib/bcn/sections";
import type { BcnSectionRow } from "@/app/api/bcn/sections/route";

export async function fetchBcnSections(vaultId: string): Promise<BcnSectionRow[]> {
  const res = await fetch(`/api/bcn/sections?vault_id=${encodeURIComponent(vaultId)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to load sections");
  }
  const data = (await res.json()) as { sections: BcnSectionRow[] };
  return data.sections ?? [];
}

export async function saveBcnSection(input: {
  vaultId: string;
  sectionId: string;
  payload: BcnSectionPayload;
  sealedAt?: string | null;
  unseal?: boolean;
}): Promise<void> {
  const res = await fetch("/api/bcn/sections", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vault_id: input.vaultId,
      section_id: input.sectionId,
      payload: input.payload,
      sealed_at: input.sealedAt,
      unseal: input.unseal,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to save section");
  }
}
