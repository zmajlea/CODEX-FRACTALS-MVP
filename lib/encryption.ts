"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decryptStringWithPassword,
  encryptStringWithPassword,
} from "./encryption-core";
import type { Database } from "./database.types";

const KEY_VALIDATION_PREFIX = "CODEXONE_KEY_VALIDATION";

/**
 * Validate encryption key by decrypting the vault's encryption_test field.
 */
export async function validateEncryptionKey(
  vaultId: string,
  key: string,
  supabase: SupabaseClient<Database>
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("vaults")
      .select("encryption_test")
      .eq("id", vaultId)
      .maybeSingle();

    if (error || !data) {
      console.warn("Vault not found for key validation:", vaultId, error?.message);
      return false;
    }

    if (!data.encryption_test) {
      return true;
    }

    try {
      const decrypted = await decryptStringWithPassword(
        data.encryption_test,
        key
      );
      return decrypted.startsWith(KEY_VALIDATION_PREFIX);
    } catch {
      return false;
    }
  } catch (error) {
    console.error("Error validating encryption key:", error);
    return false;
  }
}

/**
 * Store an encrypted validation blob on the vault for future key checks.
 */
export async function setVaultEncryptionKeyTest(
  vaultId: string,
  key: string,
  supabase: SupabaseClient<Database>
): Promise<void> {
  const encryptedTest = await encryptStringWithPassword(
    KEY_VALIDATION_PREFIX,
    key
  );

  const { error } = await supabase
    .from("vaults")
    .update({
      encryption_test: encryptedTest,
      encryption_test_updated_at: new Date().toISOString(),
    })
    .eq("id", vaultId);

  if (error) {
    throw new Error(error.message);
  }
}

export { encryptStringWithPassword, decryptStringWithPassword } from "./encryption-core";
export { encryptFileBlob, decryptFileBlob } from "./encryption-core";
