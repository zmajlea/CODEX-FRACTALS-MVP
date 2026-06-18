import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { encryptStringWithPassword } from "@/lib/encryption";
import { getVaultSessionKey } from "@/lib/vault-session";
import { composeLabel } from "@/lib/temporal/event-types";

export type SealPulseInput = {
  pulseId: string;
  vaultId: string;
  recordId: string;
  eventType: string;
  qualifier: string;
  body: string;
  explanation?: string;
  category?: string;
  parsedDate?: string | null;
};

export async function sealPulse(
  supabase: SupabaseClient<Database>,
  input: SealPulseInput
): Promise<{ sealedAt: string; sealedBy: string | null }> {
  const sessionKey = getVaultSessionKey(input.vaultId);
  if (!sessionKey) {
    throw new Error("Record is locked. Enter your encryption key first.");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sealedAt = new Date().toISOString();
  const composedTitle = composeLabel(input.eventType, input.qualifier);
  const title_ciphertext = await encryptStringWithPassword(
    composedTitle,
    sessionKey
  );
  const qualifier_ciphertext = await encryptStringWithPassword(
    input.qualifier,
    sessionKey
  );
  const body_ciphertext = await encryptStringWithPassword(
    input.body,
    sessionKey
  );
  const explanation_ciphertext = input.explanation
    ? await encryptStringWithPassword(input.explanation, sessionKey)
    : null;

  const { error } = await supabase
    .from("temporal_objects")
    .update({
      title_ciphertext,
      qualifier_ciphertext,
      event_type: input.eventType,
      body_ciphertext,
      explanation_ciphertext,
      category: input.category ?? null,
      parsed_date: input.parsedDate ?? null,
      verified_at: sealedAt,
      verified_by: user?.id ?? null,
    })
    .eq("id", input.pulseId)
    .eq("vault_id", input.vaultId);

  if (error) throw new Error(error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("record_activity_events").insert({
    vault_id: input.vaultId,
    record_id: input.recordId,
    event_type: "pulse_sealed",
    actor_id: user?.id ?? null,
    payload: { pulse_id: input.pulseId, sealed_at: sealedAt },
  });

  return { sealedAt, sealedBy: user?.id ?? null };
}
