# 06 — Security and E2E Encryption

## Invariant

> **ALL sensitive document data and extracted objects MUST be E2E encrypted client-side before hitting Supabase. The server only sees ciphertext.**

This applies to:

- File blobs in Storage (`vault-files` bucket)
- `temporal_objects.title_ciphertext`, `body_ciphertext`, `explanation_ciphertext`, `qualifier_ciphertext`
- `files.file_name_ciphertext`

## Algorithm (`lib/encryption-core.ts`)

| Parameter | Value |
|-----------|-------|
| KDF | PBKDF2-SHA256, **250,000** iterations |
| Cipher | AES-GCM 256-bit |
| Salt | 16 bytes (prepended) |
| IV | 12 bytes |
| Wire format | `base64(salt + iv + ciphertext)` |

## Vault key validation

On vault create/update, client encrypts constant `CODEXONE_KEY_VALIDATION` → stored in `vaults.encryption_test`. Unlock modal decrypts to verify password before storing session key.

## Session key storage

```ts
// lib/vault-session.ts
sessionStorage["codexone_key_{vaultId}"] = userEnteredPassword
```

Cleared on sign-out (`DashboardShell` → `clearVaultSessionKeys`).

## Plaintext columns (queryable metadata)

These are **intentionally** not encrypted (RLS still applies):

| Column | Table | Why |
|--------|-------|-----|
| `parsed_date` | temporal_objects | Timeline sort/filter |
| `category` | temporal_objects | Kind mapping |
| `event_type` | temporal_objects | Controlled vocab filter |
| `lens_id` | temporal_objects | Extraction lens |
| `verified_at` | temporal_objects | Sealed vs proposed |

## Gemini API boundary

Document **text** is sent to `/api/gemini-extract` server-side (requires `GOOGLE_GENAI_API_KEY`). This is a deliberate tradeoff: extraction needs LLM; sealed storage remains E2E encrypted.

## RLS

All tables have Row Level Security. Vault access via `vault_members`. Users only see rows for vaults they belong to.

## Agent mistakes to avoid

- ❌ Storing plaintext titles/bodies in Postgres
- ❌ Logging decrypted content server-side
- ❌ Putting vault passwords in env vars or git
- ❌ Using service role key in client bundles
- ✅ Encrypt before `.insert()` / `.update()` in seal-batch and seal-pulse
