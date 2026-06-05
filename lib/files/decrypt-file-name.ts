import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
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

  const names: Record<string, string> = {};
  for (const file of files) {
    if (!file.file_name_ciphertext) {
      names[file.id] = file.id.slice(0, 8);
      continue;
    }
    try {
      names[file.id] = await decryptStringWithPassword(
        file.file_name_ciphertext,
        sessionKey
      );
    } catch {
      names[file.id] = file.id.slice(0, 8);
    }
  }
  return names;
}
