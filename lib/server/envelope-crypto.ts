import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

const DEK_BYTE_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Per-client envelope encryption via Supabase Vault.
 *
 * Portability: to move off Vault to AWS/GCP KMS, only ensureClientDek/getClientDek
 * need to change (generate/unwrap the DEK via KMS); wire format and callers stay the same.
 */

function dekFromBase64(dekB64: string): Buffer {
  const dek = Buffer.from(dekB64, "base64");
  if (dek.length !== DEK_BYTE_LENGTH) {
    throw new Error("Invalid DEK length");
  }
  return dek;
}

async function vaultCreateSecret(
  admin: AdminClient,
  secret: string,
  name: string,
  description: string
): Promise<string> {
  const { data, error } = await admin.rpc("internal_vault_create_secret", {
    p_secret: secret,
    p_name: name,
    p_description: description,
  });
  if (error) throw error;
  if (!data) throw new Error("Vault create_secret returned no id");
  return String(data);
}

async function vaultReadSecret(admin: AdminClient, secretId: string): Promise<string> {
  const { data, error } = await admin.rpc("internal_vault_read_secret", {
    p_id: secretId,
  });
  if (error) throw error;
  if (!data) throw new Error("Vault secret not found");
  return String(data);
}

async function vaultDeleteSecret(admin: AdminClient, secretId: string): Promise<void> {
  const { error } = await admin.rpc("internal_vault_delete_secret", {
    p_id: secretId,
  });
  if (error) throw error;
}

export async function getClientDek(
  admin: AdminClient,
  clientUserId: string
): Promise<string> {
  const { data: row, error } = await admin
    .from("client_encryption_keys")
    .select("dek_secret_id")
    .eq("client_user_id", clientUserId)
    .maybeSingle();

  if (error) throw error;
  if (!row?.dek_secret_id) {
    throw new Error("Client encryption key not found");
  }

  return vaultReadSecret(admin, row.dek_secret_id);
}

export async function ensureClientDek(
  admin: AdminClient,
  clientUserId: string
): Promise<string> {
  const { data: existing } = await admin
    .from("client_encryption_keys")
    .select("dek_secret_id")
    .eq("client_user_id", clientUserId)
    .maybeSingle();

  if (existing?.dek_secret_id) {
    return getClientDek(admin, clientUserId);
  }

  const dekB64 = randomBytes(DEK_BYTE_LENGTH).toString("base64");
  const secretId = await vaultCreateSecret(
    admin,
    dekB64,
    `client_dek:${clientUserId}`,
    "Per-client DEK for envelope encryption"
  );

  const { error: insertErr } = await admin.from("client_encryption_keys").insert({
    client_user_id: clientUserId,
    dek_secret_id: secretId,
  });

  if (insertErr) throw insertErr;
  return dekB64;
}

export async function encryptForClient(
  admin: AdminClient,
  clientUserId: string,
  plaintext: string
): Promise<string> {
  const dekB64 = await ensureClientDek(admin, clientUserId);
  const dek = dekFromBase64(dekB64);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export async function decryptForClient(
  admin: AdminClient,
  clientUserId: string,
  ciphertext: string
): Promise<string> {
  const dekB64 = await getClientDek(admin, clientUserId);
  const dek = dekFromBase64(dekB64);
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Invalid ciphertext");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", dek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  );
}

export async function destroyClientKey(
  admin: AdminClient,
  clientUserId: string
): Promise<void> {
  const { data: row, error } = await admin
    .from("client_encryption_keys")
    .select("dek_secret_id")
    .eq("client_user_id", clientUserId)
    .maybeSingle();

  if (error) throw error;
  if (!row?.dek_secret_id) return;

  await vaultDeleteSecret(admin, row.dek_secret_id);
  const { error: delErr } = await admin
    .from("client_encryption_keys")
    .delete()
    .eq("client_user_id", clientUserId);
  if (delErr) throw delErr;
}
