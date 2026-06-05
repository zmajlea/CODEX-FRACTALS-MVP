# Fractals MVP — Quick Test Scenarios (Journeys 1–3)

Condensed smoke tests for the core truthmaking loop. **Full Release 1 plan (Journeys 1–10 + S1–S12):** [test-scenarios-release1.md](./test-scenarios-release1.md)

Manual + Cursor browser MCP smoke tests for Release 1 truthmaking flows.

**Base URL:** `http://localhost:14000`  
**Prerequisites:** `.env.local` with Supabase + (optional) `GOOGLE_GENAI_API_KEY` for Journey 2 extract.

---

## Seed data (run once per tester)

### Quick seed (automated)

```powershell
cd c:\CODEX_FACTALS\CODEX-FRACTALS-MVP
node scripts/seed-journey-test.mjs
```

Creates (or reuses) a dedicated test account and vault:

| Field | Value |
|-------|-------|
| Email | `journey1-test@codexone.test` |
| Password | `Journey1Test!2026` |
| Vault name | `Journey1 Test Record` |
| Vault ID | `44d60a55-26c0-4db5-a6c8-db85f1d83de9` (stable after first seed run) |
| Vault key | `Journey1VaultKey!` |
| Sealed pulse | title **Effective Date** (recall test) |
| Unsealed pulse | title **Renewal Date** (seal test) |
| Vault 2 name | `Journey3 Second Record` |
| Vault 2 ID | `9c726bd9-c3a3-4fd7-b84a-2c8f29df6994` |
| Vault 2 key | `Journey3VaultKey!` |
| Vault 2 pulse | **Closing Date** (Results Mode / Journey 3) |

### 1. Auth

- Sign up or log in at `/login` (email/password is easiest for automation).
- Or use the quick-seed account above.
- Or use Google OAuth (requires manual Google step).

### 2. Test record (vault)

**Option A — UI**

1. `/switchboard` → **Generate Vault** (empty state) or **Create** vault.
2. Copy the encryption key when prompted.
3. Vault name suggestion: `Journey Test Record`.

**Option B — existing vault**

1. Open Switchboard; click a vault card.
2. Enter encryption key in the modal.

Session key is stored as `sessionStorage['codexone_key_<vaultId>']`.

### 3. Temporal pulses (Journey 1)

Need at least one **unsealed** `temporal_object` in the vault:

**Via Extract (recommended)**

1. Unlock vault on Switchboard.
2. `/vault/<vaultId>/ingest` → upload a PDF, or `/vault/<vaultId>/extract`.
3. Run Gemini extract → triage → **do not seal all** — leave one Date row unsealed for Journey 1 seal test.

**Verify in Supabase SQL**

```sql
SELECT id, vault_id, category, parsed_date, verified_at
FROM temporal_objects
WHERE vault_id = '<your-vault-uuid>'
ORDER BY created_at DESC
LIMIT 10;
```

- `verified_at IS NULL` → Amber candidate (sealable in Inspector).
- `verified_at IS NOT NULL` → Bone sealed (recall / at-rest).

### 4. Multi-vault (Journey 3)

- Unlock **2+** vaults on Switchboard (enter key for each).
- Each should have at least one Date `temporal_object` with `parsed_date` set.

---

## Journey 1 — Query → Inspect → Seal → Recall

**Surfaces:** Gateway → Record Home → Query → Inspector → Seal → Record Home

| Step | Action | Expected |
|------|--------|----------|
| 1 | `/switchboard` — click unlocked vault card | Navigate to `/vault/<id>` |
| 2 | Record Home loads | Nautilus + ledger visible; sealed pulses at rest (Bone) |
| 3 | Bottom query bar — search title/date substring | Candidates appear in ledger; Amber for unsealed |
| 4 | Click ledger row or Nautilus pulse | Row/pulse focused (sync) |
| 5 | Press **Enter** or double-click row | Inspector opens (Clean / Original / History) |
| 6 | Unsealed pulse — **Seal Pulse** | Success; pulse becomes sealed; `verified_at` set |
| 7 | Close Inspector — run same query again | Returns existing sealed pulse (recall dedupe) |

**Low-entropy check:** Ledger rows show date, category, title only — no body in list.

**Blockers for automation**

- Vault key modal if session key missing.
- No unsealed objects → seal step skipped.

---

## Journey 2 — Ingest PDFs → Extract → Inspect → Seal

**Surfaces:** Record Home → Ingest / Extract → queues → Inspector → Seal

| Step | Action | Expected |
|------|--------|----------|
| 1 | `/vault/<id>/ingest` | Scan mode toggle; upload UI; job status |
| 2 | Upload PDF | File encrypts client-side; storage upload succeeds |
| 3 | `/vault/<id>/extract` — select file, run lens | Triage suggestions list |
| 4 | Review & seal batch (Hanko) | `temporal_objects` inserted encrypted |
| 5 | Return to Record Home | New pulses in Nautilus/ledger |
| 6 | Open in Inspector → seal single pulse | Journey 1 seal path works |

**Requires:** `GOOGLE_GENAI_API_KEY`, PDF in vault storage.

---

## Journey 3 — Cross-portfolio recall (Results Mode)

**Surfaces:** Gateway → Results drawer → sequestered Inspector

| Step | Action | Expected |
|------|--------|----------|
| 1 | `/switchboard` | Portfolio cards visible |
| 2 | Toggle **Results Mode ON** | Right ledger drawer; cards remain visible |
| 3 | Scope chips | Toggle which unlocked vaults are in scope |
| 4 | Click timeline row | Inspector opens with owning record context |
| 5 | Close Inspector | Returns to Results Mode (scroll/scope preserved) |
| 6 | `/portfolio` | Redirects to `/switchboard?results=1` |

**Low-entropy check:** Timeline rows — title + category + vault tag; no body snippets.

---

## Cursor agent prompt (copy-paste)

```
Browser-test Journey 1 on http://localhost:14000 using docs/test-scenarios.md.
If blocked at login or vault key, report what's needed.
Fix failures and re-test until Journey 1 steps 1–7 pass or document blockers.
```

---

## EXAKOM BUSINESS DEV (Journey 2 — multi-format)

Seed vault with CRM/leads files from the EXAKOM mailing folder:

```powershell
cd c:\CODEX_FACTALS\CODEX-FRACTALS-MVP
npm run test:seed:exakom          # upload + Gemini extract + seal
npm run test:seed:exakom:upload   # upload only (no API calls)
```

| Field | Value |
|-------|-------|
| Vault name | `EXAKOM BUSINESS DEV` |
| Vault ID | `6fac0c0b-b853-49a9-916f-578e88b88a3e` (stable after first run) |
| Vault key | `ExakomBusinessDev!2026` |
| Source folder | `C:\Users\leander\Documents\Claude\Projects\Mailing EXAKOM` |
| Formats | PDF, CSV, MD, TXT, HTML, XLSX, DOCX |

1. Login → Switchboard → unlock **EXAKOM BUSINESS DEV** with key above.
2. **Record Home** (`/vault/<id>`) — Nautilus should show hubs per file + sealed pulses.
3. **Ingest** — multi-select upload for any supported format.
4. **Extract** — use **CRM & Leads** lens → Run extraction → Review & Seal.

Re-run seed to process files that failed on Gemini rate limits (skips files that already have pulses).

---

## Browser test log (2026-06-05 — latest full run)

| Journey | Status | Notes |
|---------|--------|-------|
| 1 — Query → Seal → Recall | **PASS** | Seal Renewal; recall Effective (Anchored) |
| 2 — Ingest → Extract | **PARTIAL** | Ingest UI OK; extract empty (no PDF) |
| 3 — Results Mode | **PASS** | 3 pulses; sequestered Inspector; portfolio redirect |
| 4 — Governance | **PARTIAL** | Invite UI on Settings; lifecycle not wired |
| 5 — Revisioning | **PARTIAL** | History tab empty state only |
| 6 — Inbox | **PASS** | Panel + empty unread state |
| 7 — Profile | **PARTIAL** | Identity + audit toggle; authorities shell |
| 8 — Record Settings | **PASS** | Key posture + members + invite |
| 9 — Signature | **—** | Not tested (shell) |
| 10 — Alerts | **—** | Not tested |

Full details: [test-scenarios-release1.md](./test-scenarios-release1.md#browser-test-log)

**Dev server:** `npm run dev:14000` (or `npx next dev -p 14000`)

---

## Known automation limits

| Item | Workaround |
|------|------------|
| Google OAuth | Use email/password test user |
| Vault key | Pre-unlock vault in same browser session before test |
| Gemini extract | Pre-seed `temporal_objects` via extract UI once |
| Empty Nautilus | Seed at least one Date object |
