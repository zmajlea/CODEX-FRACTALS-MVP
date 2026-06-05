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

  let vaultId;
  const { data: existingVaults } = await supabase
    .from("vaults")
    .select("id, name")
    .eq("name", VAULT_NAME)
    .limit(1);
  if (existingVaults?.[0]) {
    vaultId = existingVaults[0].id;
    console.log("Reusing vault", vaultId);
  } else {
    const { data: vault, error: vaultError } = await supabase.rpc("create_vault", {
      p_name: VAULT_NAME,
    });
    if (vaultError || !vault) {
      console.error("create_vault failed:", vaultError?.message);
      process.exit(1);
    }
    vaultId = vault.id;
    const encryptionTest = await encryptStringWithPassword(
      KEY_VALIDATION_PREFIX,
      VAULT_KEY
    );
    const { error: keyError } = await supabase
      .from("vaults")
      .update({
        encryption_test: encryptionTest,
        encryption_test_updated_at: new Date().toISOString(),
      })
      .eq("id", vaultId);
    if (keyError) {
      console.error("encryption_test update failed:", keyError.message);
      process.exit(1);
    }
    console.log("Created vault", vaultId);
  }

  let recordId;
  const { data: existingRecord } = await supabase
    .from("records")
    .select("id")
    .eq("vault_id", vaultId)
    .limit(1)
    .maybeSingle();
  if (existingRecord) {
    recordId = existingRecord.id;
  } else {
    const { data: created, error: recError } = await supabase
      .from("records")
      .insert({
        vault_id: vaultId,
        title_plain: "Inbox",
        status: "draft",
        created_by: userId,
      })
      .select("id")
      .single();
    if (recError || !created) {
      console.error("record insert failed:", recError?.message);
      process.exit(1);
    }
    recordId = created.id;
    console.log("Created record", recordId);
  }

  const pulses = [
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
  ];

  for (const pulse of pulses) {
    const titleCipher = await encryptStringWithPassword(pulse.title, VAULT_KEY);
    const bodyCipher = await encryptStringWithPassword(pulse.body, VAULT_KEY);
    const titleMatch = await supabase
      .from("temporal_objects")
      .select("id, title_ciphertext, verified_at")
      .eq("vault_id", vaultId);
    const rows = titleMatch.data ?? [];
    let found = null;
    for (const row of rows) {
      try {
        const dec = await decryptForMatch(row.title_ciphertext, VAULT_KEY);
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
    if (insertError) {
      console.error("pulse insert failed:", pulse.title, insertError.message);
      process.exit(1);
    }
    console.log("Inserted pulse:", pulse.title, pulse.sealed ? "sealed" : "unsealed");
  }

  console.log("\n--- Journey 1 seed ready ---");
  console.log("Login:", TEST_EMAIL, "/", TEST_PASSWORD);
  console.log("Vault ID:", vaultId);
  console.log("Vault key:", VAULT_KEY);
  console.log("Query hints: 'Effective', 'Renewal', '2023-09-28'");
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
