"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { encryptFileBlob, encryptStringWithPassword } from "@/lib/encryption";
import { getVaultSessionKey } from "@/lib/vault-session";

const BUCKET = "vault-files";

export type UploadEncryptedFileResult = {
  fileId: string;
  storagePath: string;
};

/**
 * E2E encrypt a file client-side and upload ciphertext to Supabase Storage.
 */
export async function uploadEncryptedFile(
  supabase: SupabaseClient<Database>,
  params: {
    vaultId: string;
    recordId: string;
    file: File;
  }
): Promise<UploadEncryptedFileResult> {
  const sessionKey = getVaultSessionKey(params.vaultId);
  if (!sessionKey) {
    throw new Error("Vault is locked. Enter your encryption key first.");
  }

  const fileId = crypto.randomUUID();
  const storagePath = `${params.vaultId}/${params.recordId}/${fileId}.enc`;

  const encryptedBlob = await encryptFileBlob(params.file, sessionKey);
  const fileNameCiphertext = await encryptStringWithPassword(
    params.file.name,
    sessionKey
  );

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, encryptedBlob, {
      contentType: "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error: insertError } = await supabase
    .from("files")
    .insert({
      id: fileId,
      vault_id: params.vaultId,
      record_id: params.recordId,
      uploaded_by: user?.id ?? null,
      storage_path: storagePath,
      file_name_ciphertext: fileNameCiphertext,
      mime_type: params.file.type || "application/octet-stream",
      byte_size: params.file.size,
      encrypted: true,
    })
    .select("id, storage_path")
    .single();

  if (insertError || !data) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(insertError?.message ?? "Failed to save file metadata");
  }

  return { fileId: data.id, storagePath: data.storage_path };
}
