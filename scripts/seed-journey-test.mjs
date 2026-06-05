/**
 * Seeds Journey 1 browser-test data: test user vault + encrypted pulses.
 * Usage: node scripts/seed-journey-test.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env.mjs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

const TEST_EMAIL = "journey1-test@codexone.test";
const TEST_PASSWORD = "Journey1Test!2026";
const VAULT_NAME = "Journey1 Test Record";
const VAULT_KEY = "Journey1VaultKey!";
const VAULT2_NAME = "Journey3 Second Record";
const VAULT2_KEY = "Journey3VaultKey!";

const PBKDF2_ITERATIONS = 250000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_VALIDATION_PREFIX = "CODEXONE_KEY_VALIDATION";

async function encryptStringWithPassword(plaintext, password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), SALT_LENGTH + IV_LENGTH);
  return Buffer.from(combined).toString("base64");
}

async function ensureVault(supabase, userId, name, key) {
  const { data: existing } = await supabase
    .from("vaults")
    .select("id, name")
    .eq("name", name)
    .limit(1);
  if (existing?.[0]) {
    console.log("Reusing vault", existing[0].id, name);
    return existing[0].id;
  }
  const { data: vault, error: vaultError } = await supabase.rpc("create_vault", {
    p_name: name,
  });
  if (vaultError || !vault) {
    throw new Error(`create_vault failed for ${name}: ${vaultError?.message}`);
  }
  const encryptionTest = await encryptStringWithPassword(KEY_VALIDATION_PREFIX, key);
  const { error: keyError } = await supabase
    .from("vaults")
    .update({
      encryption_test: encryptionTest,
      encryption_test_updated_at: new Date().toISOString(),
    })
    .eq("id", vault.id);
  if (keyError) throw new Error(keyError.message);
  console.log("Created vault", vault.id, name);
  return vault.id;
}

async function ensureRecord(supabase, userId, vaultId) {
  const { data: existing } = await supabase
    .from("records")
    .select("id")
    .eq("vault_id", vaultId)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await supabase
    .from("records")
    .insert({
      vault_id: vaultId,
      title_plain: "Inbox",
      status: "draft",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "record insert failed");
  console.log("Created record", created.id);
  return created.id;
}

async function seedPulses(supabase, userId, vaultId, vaultKey, pulses) {
  const recordId = await ensureRecord(supabase, userId, vaultId);
  for (const pulse of pulses) {
    const titleCipher = await encryptStringWithPassword(pulse.title, vaultKey);
    const bodyCipher = await encryptStringWithPassword(pulse.body, vaultKey);
    const { data: rows } = await supabase
      .from("temporal_objects")
      .select("id, title_ciphertext, verified_at")
      .eq("vault_id", vaultId);
    let found = null;
    for (const row of rows ?? []) {
      try {
        const dec = await decryptForMatch(row.title_ciphertext, vaultKey);
        if (dec === pulse.title) found = row;
      } catch {
        /* skip */
      }
    }
    if (found) {
      if (!pulse.sealed && found.verified_at) {
        await supabase
          .from("temporal_objects")
          .update({ verified_at: null, verified_by: null })
          .eq("id", found.id);
        console.log("Reset unsealed:", pulse.title);
      } else {
        console.log("Exists:", pulse.title, found.verified_at ? "sealed" : "unsealed");
      }
      continue;
    }
    const now = new Date().toISOString();
    const { error: insertError } = await supabase.from("temporal_objects").insert({
      vault_id: vaultId,
      record_id: recordId,
      created_by: userId,
      kind: "date",
      title_ciphertext: titleCipher,
      body_ciphertext: bodyCipher,
      category: pulse.category,
      parsed_date: pulse.parsed_date,
      encrypted: true,
      verified_at: pulse.sealed ? now : null,
      verified_by: pulse.sealed ? userId : null,
    });
    if (insertError) throw new Error(`${pulse.title}: ${insertError.message}`);
    console.log("Inserted pulse:", pulse.title, pulse.sealed ? "sealed" : "unsealed");
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, anon);
  const { data: auth, error: signInError } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (signInError) {
    console.error("Sign-in failed:", signInError.message);
    process.exit(1);
  }
  const userId = auth.user.id;
  console.log("Signed in as", TEST_EMAIL, userId);

  const vaultId = await ensureVault(supabase, userId, VAULT_NAME, VAULT_KEY);
  await seedPulses(supabase, userId, vaultId, VAULT_KEY, [
    {
      title: "Effective Date",
      body: "This agreement is effective September 28, 2023.",
      category: "Date",
      parsed_date: "2023-09-28",
      sealed: true,
    },
    {
      title: "Renewal Date",
      body: "The contract renews on May 2, 2025 unless terminated.",
      category: "Date",
      parsed_date: "2025-05-02",
      sealed: false,
    },
  ]);

  const vault2Id = await ensureVault(supabase, userId, VAULT2_NAME, VAULT2_KEY);
  await seedPulses(supabase, userId, vault2Id, VAULT2_KEY, [
    {
      title: "Closing Date",
      body: "Transaction closes on December 15, 2024.",
      category: "Date",
      parsed_date: "2024-12-15",
      sealed: true,
    },
  ]);

  console.log("\n--- Journey seed ready ---");
  console.log("Login:", TEST_EMAIL, "/", TEST_PASSWORD);
  console.log("Vault 1:", vaultId, "key:", VAULT_KEY);
  console.log("Vault 2:", vault2Id, "key:", VAULT2_KEY);
  console.log("Query hints: 'Effective', 'Renewal', 'Closing'");
}

async function decryptForMatch(encryptedBase64, password) {
  const combined = Buffer.from(encryptedBase64, "base64");
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
