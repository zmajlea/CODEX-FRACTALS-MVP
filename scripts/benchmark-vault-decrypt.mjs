/**
 * Benchmark vault temporal object decrypt (summary vs full).
 * Usage: node scripts/benchmark-vault-decrypt.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env.mjs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

const VAULT_ID = "6fac0c0b-b853-49a9-916f-578e88b88a3e";
const VAULT_KEY = "ExakomBusinessDev!2026";
const TEST_EMAIL = "journey1-test@codexone.test";
const TEST_PASSWORD = "Journey1Test!2026";
const BATCH = 50;

const PBKDF2_ITERATIONS = 250000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

const passwordImportKeyCache = new Map();
const derivedKeyCache = new Map();

function saltCacheKey(password, salt) {
  let hex = "";
  for (let i = 0; i < salt.length; i++) hex += salt[i].toString(16).padStart(2, "0");
  return `${password}\0${hex}`;
}

async function getPasswordImportKey(password) {
  let pending = passwordImportKeyCache.get(password);
  if (!pending) {
    pending = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );
    passwordImportKeyCache.set(password, pending);
  }
  return pending;
}

async function getOrDeriveKey(password, salt) {
  const cacheKey = saltCacheKey(password, salt);
  let pending = derivedKeyCache.get(cacheKey);
  if (!pending) {
    const passwordKey = await getPasswordImportKey(password);
    pending = crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      passwordKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    derivedKeyCache.set(cacheKey, pending);
  }
  return pending;
}

async function decryptField(ciphertext, password) {
  const combined = Buffer.from(ciphertext, "base64");
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const data = combined.slice(SALT_LENGTH + IV_LENGTH);
  const key = await getOrDeriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

async function decryptRows(rows, mode) {
  const fileCache = new Map();
  const start = performance.now();
  let firstBatchAt = null;

  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const chunk = rows.slice(offset, offset + BATCH);
    await Promise.all(
      chunk.map(async (row) => {
        await decryptField(row.title_ciphertext, VAULT_KEY);
        if (mode === "full") {
          if (row.body_ciphertext) await decryptField(row.body_ciphertext, VAULT_KEY);
          if (row.explanation_ciphertext) {
            await decryptField(row.explanation_ciphertext, VAULT_KEY);
          }
        }
        if (row.files?.file_name_ciphertext) {
          const fk = `${row.file_id}`;
          if (!fileCache.has(fk)) {
            fileCache.set(
              fk,
              await decryptField(row.files.file_name_ciphertext, VAULT_KEY)
            );
          }
        }
      })
    );
    if (firstBatchAt === null) firstBatchAt = performance.now() - start;
  }

  return {
    totalMs: performance.now() - start,
    firstBatchMs: firstBatchAt,
    count: rows.length,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const supabase = createClient(url, anon);
  await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });

  const fetchStart = performance.now();
  const { data, error } = await supabase
    .from("temporal_objects")
    .select(
      "id, file_id, title_ciphertext, body_ciphertext, explanation_ciphertext, files(file_name_ciphertext)"
    )
    .eq("vault_id", VAULT_ID);
  if (error) throw error;
  const fetchMs = performance.now() - fetchStart;

  derivedKeyCache.clear();
  passwordImportKeyCache.clear();
  const summary = await decryptRows(data, "summary");

  derivedKeyCache.clear();
  passwordImportKeyCache.clear();
  const full = await decryptRows(data, "full");

  console.log("\n--- EXAKOM vault decrypt benchmark ---");
  console.log(`Rows: ${data.length}`);
  console.log(`Supabase fetch: ${fetchMs.toFixed(0)}ms`);
  console.log(`Summary (title only) first batch (~${BATCH}): ${summary.firstBatchMs.toFixed(0)}ms`);
  console.log(`Summary (title only) total: ${summary.totalMs.toFixed(0)}ms`);
  console.log(`Full (title+body+explanation) total: ${full.totalMs.toFixed(0)}ms`);
  console.log(`Speedup summary vs full: ${(full.totalMs / summary.totalMs).toFixed(1)}x`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
