# Test users & passwords — journey + gate reference

**Project:** Supabase `tswdwmtrirdhtwqmsasz`  
**Local app:** http://localhost:14000  
**Production:** https://codex-fractals-mvp.vercel.app  

All `@codexone.test` users are created with `email_confirm: true` (no inbox needed).  
Seed scripts **reset passwords** to the values below on every run.

> **Not listed here:** your personal Gmail/production login, `.env.local` secrets (DB password, service role, API keys), or vault encryption keys for records you created manually.

---

## Shared passwords (by family)

| Family | Password | Used by |
|--------|----------|---------|
| Journey / vault smoke | `Journey1Test!2026` | `journey1-test@codexone.test` |
| Summit test operator | `OperatorTest!2026` | `operator-test@codexone.test` |
| Bench import client | `BenchImport!2026` | `bench-import@codexone.test` |
| FFM demo client | `FfmDemo!2026` | `ffm-demo@codexone.test` |
| Ana gate (Spec 57+) | `ana_gate_2026!` | All `ana_gate_*@codexone.test` |
| R1 gate (Spec 49+) | `r1_gate_2026!` | All `r1_gate_*@codexone.test` |
| MCP gate (Spec B1+) | `mcp_gate_2026!` | All `mcp_*@codexone.test` + B10/B12 live gate clients |

---

## Journey 1–3 — vault / switchboard

**Seed:** `npm run test:seed`

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| End user | `journey1-test@codexone.test` | `Journey1Test!2026` | Login: `/login` |

**Vault keys (E2E encryption — not Supabase auth):**

| Vault | Key |
|-------|-----|
| Journey1 Test Record | `Journey1VaultKey!` |
| Journey3 Second Record | `Journey3VaultKey!` |

---

## EXAKOM vault (Journey 2, large seed)

**Seed:** `npm run test:seed:exakom` (needs `GOOGLE_GENAI_API_KEY`)

| Field | Value |
|-------|-------|
| Login | `journey1-test@codexone.test` / `Journey1Test!2026` |
| Vault name | EXAKOM BUSINESS DEV |
| Vault key | `ExakomBusinessDev!2026` |
| Vault ID | `6fac0c0b-b853-49a9-916f-578e88b88a3e` |

---

## Summit test operator + journey1 client (treasury UI)

**Seed:** `npm run test:seed:operator` (also needs journey1 user)

| Role | Email | Password | Portal |
|------|-------|----------|--------|
| Operator | `operator-test@codexone.test` | `OperatorTest!2026` | `/portal/login` |
| Client | `journey1-test@codexone.test` | `Journey1Test!2026` | `/client/login` |

| Field | Value |
|-------|-------|
| Tenant slug | `summit-test-op` |
| Client display | Granite Ridge Builders LLC (journey1 grant) |

---

## FFM demo client (Stage 10 book)

**Seed:** `npm run test:seed:ffm-demo` then import CSV as needed

| Role | Email | Password |
|------|-------|----------|
| Client | `ffm-demo@codexone.test` | `FfmDemo!2026` |
| Operator | `operator-test@codexone.test` | `OperatorTest!2026` |

Protected demo UUID (reset guard): `823560fa-1f73-4032-9c77-d390a261735f`

---

## Bench import (Spec 29 timing)

**Seed:** `npm run test:seed:bench-import`

| Role | Email | Password |
|------|-------|----------|
| Client | `bench-import@codexone.test` | `BenchImport!2026` |
| Operator | `operator-test@codexone.test` | `OperatorTest!2026` |

No CSV data by default — empty insert-path benchmarking.

---

## Ana gate — operator UI + rule/cash-model gates (Spec 49–68)

**Seed:** `npm run test:seed:ana-gate`  
**Book (client 1 CSV):** `npm run test:seed:ana-gate:book`  
**Cash model demo (client 2):** `npm run test:seed:cash-model-demo`

**Password for every row below:** `ana_gate_2026!`

| Role | Email | Display name | Typical gate use |
|------|-------|--------------|------------------|
| Operator | `ana_gate_operator@codexone.test` | Ana Gate Operator | Portal login, perf scripts |
| Client 1 | `ana_gate_client_1@codexone.test` | Ana Gate Client 1 | FFM book import; manual Review tab testing |
| Client 2 | `ana_gate_client_2@codexone.test` | Ana Gate Client 2 | Cash model demo seed |
| Client 3 | `ana_gate_client_3@codexone.test` | Ana Gate Client 3 | — |
| Client 4 | `ana_gate_client_4@codexone.test` | Ana Gate Client 4 | Spec 58–66 gates (wiped/rebuilt often) |

| Field | Value |
|-------|-------|
| Tenant slug | `ana-gate` |
| Operator login | `/portal/login` |
| Client login | `/client/login` |

**Known UUID (perf script, client 4):** `6d53f194-e71b-4965-aecc-eab9f81ed311`  
Re-run `npm run test:seed:ana-gate` to print current client UUIDs after recreate.

---

## R1 gate — rule reliability / forecast gates (Spec 49–55)

**Seed:** `npm run test:seed:r1-gate`  
**Book (client 1, summit-0625 only):** `npm run test:seed:r1-gate:book`

**Password for every row below:** `r1_gate_2026!`

| Role | Email | Display name | Typical gate use |
|------|-------|--------------|------------------|
| Operator | `r1_gate_operator@codexone.test` | R1 Gate Operator | — |
| Client 1 | `r1_gate_client_1@codexone.test` | R1 Gate Client 1 | Spec 54 seam |
| Client 2 | `r1_gate_client_2@codexone.test` | R1 Gate Client 2 | Spec 55 rule reliability |
| Client 3 | `r1_gate_client_3@codexone.test` | R1 Gate Client 3 | Spec 50 forecast scope |
| Client 4 | `r1_gate_client_4@codexone.test` | R1 Gate Client 4 | — |

| Field | Value |
|-------|-------|
| Tenant slug | `r1-gate` |

---

## MCP gate operators — Tim + Ana (Spec B1–B12)

**Seed:** `npm run test:seed:mcp-testers`  
**Password for all MCP users below:** `mcp_gate_2026!`

### Tim (`mcp-gate-tim` tenant)

| Role | Email | Display name |
|------|-------|--------------|
| Operator | `mcp_gate_tim@codexone.test` | MCP Gate Tim |
| Client | `mcp_tim_lakeside@codexone.test` | Tim Book — Lakeside |
| Client | `mcp_tim_summit@codexone.test` | Tim Book — Summit |
| Client | `mcp_tim_northstar@codexone.test` | Tim Book — Northstar |

### Ana (`mcp-gate-ana` tenant)

| Role | Email | Display name |
|------|-------|--------------|
| Operator | `mcp_gate_ana@codexone.test` | MCP Gate Ana |
| Client | `mcp_ana_harbor@codexone.test` | Ana Book — Harbor |
| Client | `mcp_ana_ridge@codexone.test` | Ana Book — Ridge |
| Client | `mcp_ana_valley@codexone.test` | Ana Book — Valley |

**MCP bearer tokens** (not passwords): written once to `scripts/.mcp-gate-tokens.json` (gitignored). Re-run seed to regenerate. Used by `gate:mcp-b1`, `gate:mcp-b3`, `gate:onboarding`, `gate:review`, etc.

**Retired:** `mcp_gate_leander@codexone.test` (tokens revoked on seed)

---

## Ephemeral gate users (created & discarded by scripts)

These are **not** fixed accounts — pattern only:

| Gate | Email pattern | Password | Notes |
|------|---------------|----------|-------|
| B10 onboarding | `b10.gate.<timestamp>@example.com` | `mcp_gate_2026!` | Created each `npm run gate:onboarding` run |
| B10 second client (isolation) | auto-generated `@example.com` | `mcp_gate_2026!` | Same gate script |

B12 review gate uses **MCP Tim/Ana clients** from seed above (no new emails).

---

## Gate → primary login matrix

| npm script | Operator / actor | Client under test |
|------------|------------------|-------------------|
| `gate:onboarding` | MCP Tim (API token) | Ephemeral `b10.gate.*@example.com` |
| `gate:review` | MCP operators | MCP client books |
| `gate:mcp-b3` | Tim + Ana tokens | Their 3 clients each |
| `gate:analytics-boards-b7` | MCP | MCP clients |
| `gate:metrics-b5` | MCP | MCP clients |
| `gate:metrics-ui` | MCP | MCP clients |
| `gate:b8` | MCP | MCP clients |
| `gate-spec50-forecast-scope` | — | `r1_gate_client_3@codexone.test` |
| `gate-spec54-seam` | — | `r1_gate_client_1@codexone.test` |
| `gate-spec55-rule-reliability` | `r1_gate_operator@codexone.test` | `r1_gate_client_2@codexone.test` |
| `gate-spec57-diagnosis` | `ana_gate_operator@codexone.test` | `ana_gate_client_4@codexone.test` |
| `gate-spec58` … `gate-spec66` | `ana_gate_operator@codexone.test` | `ana_gate_client_4@codexone.test` |
| `gate-spec65-cash-model` | — | `ana_gate_client_4@codexone.test` |
| `perf/journey-measure.mjs` | `ana_gate_operator@codexone.test` | Client 4 UUID hardcoded |

---

## Production / manual testing

- **Vercel:** use a **real** Supabase Auth user (e.g. Google OAuth at `/login`) — not `@codexone.test`.
- **Global admin:** `@codexone.io` emails can call `elevate_codexone_global_admin`; dev bootstrap via `POST /api/dev/claim-global-admin` (local only, `SEED_SECRET`).
- **B10 portal activate:** invite link `…/portal/activate?token=…`; client chooses password at activation (8+ chars). Gate scripts set `mcp_gate_2026!` via admin API for automation.

---

## Refresh credentials & IDs

```powershell
npm run test:seed:ana-gate          # prints operator + 4 client UUIDs
npm run test:seed:r1-gate           # prints operator + 4 client UUIDs
npm run test:seed:mcp-testers       # prints MCP bearer tokens once
npm run test:seed:operator          # summit operator + journey1 link
```

Source of truth for constants: `scripts/seed-*.mjs`, `scripts/seed-mcp-three-testers.ts`, and `scripts/gate-*.ts`.
