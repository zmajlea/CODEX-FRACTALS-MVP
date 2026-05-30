import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { decryptFileBlob } from "@/lib/encryption-core";
import { getVaultSessionKey } from "@/lib/vault-session";

const BUCKET = "vault-files";

export async function downloadDecryptedFileBlob(
  supabase: SupabaseClient<Database>,
  params: { vaultId: string; storagePath: string; encrypted?: boolean; mimeType?: string | null }
): Promise<Blob> {
  const sessionKey = getVaultSessionKey(params.vaultId);
  if (!sessionKey) {
    throw new Error("Vault is locked. Enter your encryption key first.");
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(params.storagePath);

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to download file");
  }

  if (params.encrypted !== false) {
    const decrypted = await decryptFileBlob(data, sessionKey);
    const mime = params.mimeType || "application/pdf";
    return new Blob([await decrypted.arrayBuffer()], { type: mime });
  }

  return data;
}
