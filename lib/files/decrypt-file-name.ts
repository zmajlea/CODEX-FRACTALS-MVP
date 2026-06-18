import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { mapInBatches } from "@/lib/async/map-in-batches";
import { decryptStringWithPassword } from "@/lib/encryption";
import { getVaultSessionKey } from "@/lib/vault-session";

export async function decryptFileName(
  vaultId: string,
  fileNameCiphertext: string | null
): Promise<string | null> {
  if (!fileNameCiphertext) return null;
  const sessionKey = getVaultSessionKey(vaultId);
  if (!sessionKey) return null;
  try {
    return await decryptStringWithPassword(fileNameCiphertext, sessionKey);
  } catch {
    return null;
  }
}

export async function loadDecryptedFileNames(
  supabase: SupabaseClient<Database>,
  vaultId: string,
  files: { id: string; file_name_ciphertext: string | null }[]
): Promise<Record<string, string>> {
  const sessionKey = getVaultSessionKey(vaultId);
  if (!sessionKey) return {};

  const entries = await mapInBatches(files, 50, async (file) => {
    if (!file.file_name_ciphertext) {
      return [file.id, file.id.slice(0, 8)] as const;
    }
    try {
      const name = await decryptStringWithPassword(
        file.file_name_ciphertext,
        sessionKey
      );
      return [file.id, name] as const;
    } catch {
      return [file.id, file.id.slice(0, 8)] as const;
    }
  });

  return Object.fromEntries(entries);
}
