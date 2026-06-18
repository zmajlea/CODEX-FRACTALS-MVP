/**
 * EXAKOM BUSINESS DEV — Journey 2 seed: vault + multi-format upload + Gemini extract + seal.
 *
 * Usage:
 *   node scripts/seed-exakom-vault.mjs
 *   node scripts/seed-exakom-vault.mjs --upload-only
 *   node scripts/seed-exakom-vault.mjs --source "C:\path\to\Mailing EXAKOM"
 *   node scripts/seed-exakom-vault.mjs --file "C:\path\to\extra.csv"
 */
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFileSync, readdirSync, statSync } from "fs";
import { basename, join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";
import {
  extractTextFromPath,
  getFormatForFileName,
  mimeForFile,
  shouldSkipFileName,
} from "./lib/extract-text-node.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

const TEST_EMAIL = "journey1-test@codexone.test";
const TEST_PASSWORD = "Journey1Test!2026";
const VAULT_NAME = "EXAKOM BUSINESS DEV";
const VAULT_KEY = "ExakomBusinessDev!2026";
const BUCKET = "vault-files";
const DEFAULT_SOURCE = "C:\\Users\\leander\\Documents\\Claude\\Projects\\Mailing EXAKOM";
const MODEL_NAME = "gemini-2.5-flash";

const PBKDF2_ITERATIONS = 250000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_VALIDATION_PREFIX = "CODEXONE_KEY_VALIDATION";

const COMMERCIAL_LENS = `Extract companies, contacts, leads, follow-up actions, deal stages, pricing references, market segments (fotovoltaico, papeleras, smart building), and commercial deadlines. Prefer Entity objects for companies/contacts and Date objects for follow-ups and milestones.`;

const EVENT_TYPES = [
  "Signing", "Filing Due", "Reporting Due", "Renewal", "Amendment",
  "Expiration", "Payment Due", "Commitment", "Decision", "Resolution",
];

const SYSTEM_PROMPT = `You are an expert commercial intelligence AI for EXAKOM business development.
Extract specific milestones, risks, obligations, entities, and dates from CRM documents, lead lists, and commercial reports.

LABEL RULES (CRITICAL):
- Do NOT use document filenames or generic document titles as labels.
- Each suggestion MUST include "eventType" and "qualifier" instead of a single title.
- "eventType" MUST be exactly one of: ${EVENT_TYPES.join(", ")}.
- "qualifier" is a short actionable fragment from the clause.

CRITICAL RULE FOR DATES:
If the category is "Date", format "body" as strict ISO-8601 YYYY-MM-DD.
For non-Date categories, body MUST be an exact substring copied verbatim from the document.

Return strict JSON:
{ "suggestions": [{ "eventType": string, "qualifier": string, "category": "Date" | "Warning" | "Obligation" | "Entity", "body": string, "explanation": string }] }
Prefer high-signal items (max ~15 per document).`;

function parseArgs() {
  const args = process.argv.slice(2);
  const uploadOnly = args.includes("--upload-only");
  let source = DEFAULT_SOURCE;
  const extraFiles = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && args[i + 1]) {
      source = args[i + 1];
      i += 1;
    } else if (args[i] === "--file" && args[i + 1]) {
      extraFiles.push(resolve(args[i + 1]));
      i += 1;
    }
  }
  return { uploadOnly, source: resolve(source), extraFiles };
}

function resolveFileEntries(source, extraFiles) {
  if (extraFiles.length > 0) {
    return extraFiles.map((filePath) => {
      const fileName = basename(filePath);
      if (shouldSkipFileName(fileName) || !getFormatForFileName(fileName)) {
        throw new Error(`Unsupported or skipped file: ${filePath}`);
      }
      return { fileName, filePath };
    });
  }
  return listSourceFiles(source).map((fileName) => ({
    fileName,
    filePath: join(source, fileName),
  }));
}

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
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), SALT_LENGTH + IV_LENGTH);
  return Buffer.from(combined).toString("base64");
}

async function encryptFileBuffer(buffer, password) {
  const data = new Uint8Array(buffer);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), SALT_LENGTH + IV_LENGTH);
  return Buffer.from(combined);
}

async function decryptString(encryptedBase64, password) {
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
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

function categoryToKind(category) {
  const c = (category ?? "").toLowerCase();
  if (c === "date") return "date";
  if (c === "party" || c === "entity") return "party";
  if (c === "obligation" || c === "milestone") return "obligation";
  if (c === "financial") return "amount";
  return "other";
}

function inferParsedDate(category, title, body, modelDate) {
  if (modelDate && /^\d{4}-\d{2}-\d{2}$/.test(modelDate.trim())) return modelDate.trim();
  if ((category ?? "").toLowerCase() !== "date") return null;
  for (const source of [body, title]) {
    const iso = source?.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];
  }
  return null;
}

function listSourceFiles(sourceDir) {
  return readdirSync(sourceDir)
    .filter((name) => {
      if (shouldSkipFileName(name)) return false;
      const full = join(sourceDir, name);
      if (!statSync(full).isFile()) return false;
      return getFormatForFileName(name) !== null;
    })
    .sort();
}

async function ensureVault(supabase, name, key) {
  const { data: existing } = await supabase.from("vaults").select("id, name").eq("name", name).limit(1);
  if (existing?.[0]) {
    console.log("Reusing vault", existing[0].id, name);
    return existing[0].id;
  }
  const { data: vault, error } = await supabase.rpc("create_vault", { p_name: name });
  if (error || !vault) throw new Error(`create_vault: ${error?.message}`);
  const encryptionTest = await encryptStringWithPassword(KEY_VALIDATION_PREFIX, key);
  const { error: keyError } = await supabase
    .from("vaults")
    .update({ encryption_test: encryptionTest, encryption_test_updated_at: new Date().toISOString() })
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
      title_plain: "EXAKOM Inbox",
      status: "draft",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "record insert failed");
  console.log("Created record", created.id);
  return created.id;
}

async function listExistingFileNames(supabase, vaultId, vaultKey) {
  const { data: rows } = await supabase
    .from("files")
    .select("id, file_name_ciphertext")
    .eq("vault_id", vaultId);
  const names = new Map();
  for (const row of rows ?? []) {
    if (!row.file_name_ciphertext) continue;
    try {
      const name = await decryptString(row.file_name_ciphertext, vaultKey);
      names.set(name, row.id);
    } catch {
      /* skip */
    }
  }
  return names;
}

async function uploadFile(supabase, userId, vaultId, recordId, vaultKey, filePath, fileName) {
  const fileId = crypto.randomUUID();
  const storagePath = `${vaultId}/${recordId}/${fileId}.enc`;
  const plain = readFileSync(filePath);
  const encrypted = await encryptFileBuffer(plain, vaultKey);
  const fileNameCiphertext = await encryptStringWithPassword(fileName, vaultKey);

  let uploadError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    const result = await supabase.storage.from(BUCKET).upload(storagePath, encrypted, {
      contentType: "application/octet-stream",
      upsert: false,
    });
    uploadError = result.error;
    if (!uploadError) break;
  }
  if (uploadError) throw new Error(uploadError.message);

  const { data, error: insertError } = await supabase
    .from("files")
    .insert({
      id: fileId,
      vault_id: vaultId,
      record_id: recordId,
      uploaded_by: userId,
      storage_path: storagePath,
      file_name_ciphertext: fileNameCiphertext,
      mime_type: mimeForFile(fileName),
      byte_size: plain.byteLength,
      encrypted: true,
    })
    .select("id")
    .single();

  if (insertError || !data) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(insertError?.message ?? "files insert failed");
  }
  console.log("  Uploaded", fileName, "→", fileId.slice(0, 8));
  return fileId;
}

async function fileHasPulses(supabase, fileId) {
  const { count } = await supabase
    .from("temporal_objects")
    .select("id", { count: "exact", head: true })
    .eq("file_id", fileId);
  return (count ?? 0) > 0;
}

async function runGeminiExtract(genAI, text, fileName) {
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: "application/json" },
  });

  const truncated =
    text.length > 180_000
      ? `${text.slice(0, 180_000)}\n\n[Document truncated for extraction]`
      : text;

  const prompt = `
Active intelligence lens:
${COMMERCIAL_LENS}

Extract objects from EXAKOM business development file: ${fileName}
Return ONLY JSON with a "suggestions" array.

----- BEGIN DOCUMENT -----
${truncated}
----- END DOCUMENT -----
`.trim();

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      const delay = 15_000 * attempt;
      console.log(`    Retry ${attempt} in ${delay / 1000}s…`);
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const raw = result.response.text();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : parsed.suggestions ?? [];
    } catch (err) {
      lastError = err;
      const msg = err?.message ?? String(err);
      if (!/503|429|high demand|quota/i.test(msg)) throw err;
    }
  }
  throw lastError;
}

async function sealSuggestions(supabase, userId, vaultId, recordId, fileId, vaultKey, suggestions) {
  const now = new Date().toISOString();
  let saved = 0;
  for (const s of suggestions) {
    const body = (s.body ?? s.exactQuote ?? "").trim();
    const eventType = (s.eventType ?? "Decision").trim();
    const qualifier = (s.qualifier ?? s.title ?? "").trim();
    if (!qualifier || !body || !s.explanation) continue;
    const composedTitle = `${eventType} - ${qualifier}`;
    const category = s.category ?? "Other";
    const parsedDate = inferParsedDate(category, composedTitle, body, s.parsedDate);
    const row = {
      vault_id: vaultId,
      record_id: recordId,
      file_id: fileId,
      created_by: userId,
      kind: categoryToKind(category),
      title_ciphertext: await encryptStringWithPassword(composedTitle, vaultKey),
      qualifier_ciphertext: await encryptStringWithPassword(qualifier, vaultKey),
      event_type: eventType,
      body_ciphertext: await encryptStringWithPassword(body, vaultKey),
      explanation_ciphertext: await encryptStringWithPassword(s.explanation.trim(), vaultKey),
      category,
      parsed_date: parsedDate,
      lens_id: "commercial",
      encrypted: true,
      verified_at: now,
      verified_by: userId,
    };
    const { error } = await supabase.from("temporal_objects").insert(row);
    if (error) throw new Error(`${composedTitle}: ${error.message}`);
    saved += 1;
  }
  return saved;
}

async function main() {
  const { uploadOnly, source, extraFiles } = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const geminiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!url || !anon) {
    console.error("Missing Supabase env vars");
    process.exit(1);
  }
  if (!uploadOnly && !geminiKey) {
    console.error("Missing GOOGLE_GENAI_API_KEY (or pass --upload-only)");
    process.exit(1);
  }

  const fileEntries = resolveFileEntries(source, extraFiles);
  if (fileEntries.length === 0) {
    console.error("No supported files to process");
    process.exit(1);
  }
  if (extraFiles.length > 0) {
    console.log(`Adding ${fileEntries.length} file(s) to ${VAULT_NAME}`);
  } else {
    console.log(`Source: ${source} (${fileEntries.length} files)`);
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
  console.log("Signed in as", TEST_EMAIL);

  const vaultId = await ensureVault(supabase, VAULT_NAME, VAULT_KEY);
  const recordId = await ensureRecord(supabase, userId, vaultId);
  const existingNames = await listExistingFileNames(supabase, vaultId, VAULT_KEY);

  const uploaded = [];
  for (const { fileName, filePath } of fileEntries) {
    if (existingNames.has(fileName)) {
      console.log("  Skip (exists):", fileName);
      uploaded.push({ fileName, fileId: existingNames.get(fileName), filePath });
      continue;
    }
    const fileId = await uploadFile(
      supabase,
      userId,
      vaultId,
      recordId,
      VAULT_KEY,
      filePath,
      fileName
    );
    uploaded.push({ fileName, fileId, filePath });
  }

  if (uploadOnly) {
    printSummary(vaultId, uploaded.length);
    return;
  }

  const genAI = new GoogleGenerativeAI(geminiKey);
  let totalSealed = 0;

  for (const { fileName, fileId, filePath } of uploaded) {
    if (await fileHasPulses(supabase, fileId)) {
      console.log("  Skip extract (has pulses):", fileName);
      continue;
    }
    console.log("  Extracting:", fileName);
    try {
      const text = await extractTextFromPath(filePath, fileName);
      const rawSuggestions = await runGeminiExtract(genAI, text, fileName);
      const saved = await sealSuggestions(
        supabase,
        userId,
        vaultId,
        recordId,
        fileId,
        VAULT_KEY,
        rawSuggestions
      );
      totalSealed += saved;
      console.log(`    Sealed ${saved} pulses from ${fileName}`);
    } catch (err) {
      console.warn(`    Failed ${fileName}:`, err.message ?? err);
    }
  }

  console.log(`\nTotal sealed pulses: ${totalSealed}`);
  printSummary(vaultId, uploaded.length);
}

function printSummary(vaultId, fileCount) {
  console.log("\n--- EXAKOM BUSINESS DEV ready ---");
  console.log("Login:", TEST_EMAIL, "/", TEST_PASSWORD);
  console.log("Vault:", vaultId, "·", VAULT_NAME);
  console.log("Key:", VAULT_KEY);
  console.log("Files:", fileCount);
  console.log("Record Home:", `http://localhost:14000/vault/${vaultId}`);
  console.log("Ingest:", `http://localhost:14000/vault/${vaultId}/ingest`);
  console.log("Extract:", `http://localhost:14000/vault/${vaultId}/extract`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
