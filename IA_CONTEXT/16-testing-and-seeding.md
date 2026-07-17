# 16 — Testing and Seeding

## Docs

| File | Scope |
|------|-------|
| `docs/test-scenarios.md` | Quick smoke (Journeys 1–3) |
| `docs/test-scenarios-release1.md` | Full Journeys 1–10 |

## Local dev URL

```
http://localhost:14000
npm run dev:14000
```

## Seed scripts

### Journey test user

```powershell
node scripts/seed-journey-test.mjs
# or: npm run test:seed
```

| Field | Value |
|-------|-------|
| Email | `journey1-test@codexone.test` |
| Password | `Journey1Test!2026` |
| Vault 1 | Journey1 Test Record / key `Journey1VaultKey!` |
| Vault 2 | Journey3 Second Record / key `Journey3VaultKey!` |

**Note:** Test user must exist in Supabase Auth (signup or dashboard). `@codexone.test` emails cannot confirm — use a real email for production testing.

### Operator test user (treasury UI)

```powershell
npm run test:seed:operator
```

| Field | Value |
|-------|-------|
| Email | `operator-test@codexone.test` |
| Password | `OperatorTest!2026` |
| Portal | `http://localhost:14000/portal/login` |
| Client | journey1-test (treasury grant via `summit-test-op` tenant) |

Creates auth user, operator role, treasury module access, and active grant over journey1-test. Idempotent — safe to re-run.

### Bench import client (Spec 29 A/B)

```powershell
npm run test:seed:bench-import
npm run test:wipe:bench-import   # between timing runs
npm run treasury:bench-import    # scripted import timing (same pipeline as UI route)
```

| Field | Value |
|-------|-------|
| Client email | `bench-import@codexone.test` |
| Password | `BenchImport!2026` |
| Operator | `operator-test@codexone.test` (grant via `summit-test-op`) |
| Data | **None** by default — fresh insert-path benchmarking |

### Summit CSV import (DB round-trip)

```powershell
npm run treasury:import-summit
```

Imports `docs/summit-ffm-0625.csv` + `docs/summit-ffm-0617.csv` into journey1-test with batched progress logging and SQL reconcile check.

### EXAKOM vault (large, ~700+ pulses)

```powershell
npm run test:seed:exakom
```

| Field | Value |
|-------|-------|
| Vault | EXAKOM BUSINESS DEV |
| Key | `ExakomBusinessDev!2026` |
| ID | `6fac0c0b-b853-49a9-916f-578e88b88a3e` |

Requires `GOOGLE_GENAI_API_KEY` for full extract+seal.

### Performance benchmark

```powershell
node scripts/benchmark-vault-decrypt.mjs
```

## Verify schema

```powershell
npm run db:verify
```

## Browser testing

Use Cursor browser MCP or manual:

1. Login → Switchboard
2. Unlock vault with key
3. Record Home — timeline loads, filter bar works
4. Extract — eventType/qualifier in triage
5. Seal — validation blocks empty labels

## Production testing

Same flows at https://codex-fractals-mvp.vercel.app with a **real** Supabase user (e.g. Gmail signup). Same Supabase project as local.

## Custom seed credentials

To seed under your own account, temporarily set `TEST_EMAIL` / `TEST_PASSWORD` in seed scripts or add env var support — scripts use `signInWithPassword` against `.env.local` Supabase project.
