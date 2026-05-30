import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { encryptStringWithPassword } from "@/lib/encryption";
import { getVaultSessionKey } from "@/lib/vault-session";
import {
  categoryToKind,
  inferParsedDate,
} from "@/lib/temporal/parse-date";
import type { IntelligenceLensId } from "@/lib/intelligence-lenses";

export type TriageSuggestion = {
  id: string;
  fileId: string;
  recordId: string;
  vaultId: string;
  title: string;
  body: string;
  category: string;
  explanation: string;
  parsedDate: string;
  lensId: IntelligenceLensId;
};

export async function sealTemporalBatch(
  supabase: SupabaseClient<Database>,
  suggestions: TriageSuggestion[]
): Promise<number> {
  const vaultId = suggestions[0]?.vaultId;
  if (!vaultId) return 0;

  const sessionKey = getVaultSessionKey(vaultId);
  if (!sessionKey) {
    throw new Error("Vault is locked. Enter your encryption key first.");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let saved = 0;
  for (const s of suggestions) {
    const parsedDate =
      inferParsedDate(s.category, s.title, s.body, s.parsedDate) ?? null;

    const row = {
      vault_id: s.vaultId,
      record_id: s.recordId,
      file_id: s.fileId,
      created_by: user?.id ?? null,
      kind: categoryToKind(s.category),
      title_ciphertext: await encryptStringWithPassword(s.title, sessionKey),
      body_ciphertext: await encryptStringWithPassword(s.body, sessionKey),
      explanation_ciphertext: await encryptStringWithPassword(
        s.explanation,
        sessionKey
      ),
      category: s.category,
      parsed_date: parsedDate,
      lens_id: s.lensId,
      encrypted: true,
      verified_at: new Date().toISOString(),
      verified_by: user?.id ?? null,
    };

    const { error } = await supabase.from("temporal_objects").insert(row);
    if (error) throw new Error(error.message);
    saved += 1;
  }

  return saved;
}
