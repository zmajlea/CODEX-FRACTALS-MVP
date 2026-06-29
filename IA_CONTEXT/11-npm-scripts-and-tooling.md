# 11 — NPM Scripts and Tooling

Run from `CODEX-FRACTALS-MVP/`.

## Development

| Script | Command | Notes |
|--------|---------|-------|
| `dev` | `next dev` | Default port 3000 |
| **`dev:14000`** | `next dev -p 14000` | **Preferred local URL** |
| `build` | `next build` | Production build + typecheck |
| `start` | `next start` | Serve production build |
| `lint` | `eslint` | Lint |

## Database / Supabase

| Script | Command |
|--------|---------|
| `db:push` | `supabase db push` |
| `db:apply` | `node scripts/apply-migration-pg.mjs` |
| `db:query` | `supabase db query --linked` |
| `db:verify` | `node scripts/verify-schema.mjs` |
| `db:types` | `supabase gen types typescript --project-id tswdwmtrirdhtwqmsasz` |
| `supabase` | `supabase` (passthrough) |
| `supabase:login` | `supabase login` |
| `auth:config:push` | `supabase config push --yes` |

## Test data

| Script | Command |
|--------|---------|
| `test:seed` | Journey 1/3 test user + vaults |
| `test:seed:exakom` | EXAKOM vault + Gemini extract + seal |
| `test:seed:exakom:upload` | Upload only (no Gemini) |
| `test:seed:exakom:file` | Single extra file via `--file` |

## Utility scripts (direct node)

| Script | Purpose |
|--------|---------|
| `scripts/benchmark-vault-decrypt.mjs` | Perf benchmark for large vaults |
| `scripts/verify-schema.mjs` | Post-migration sanity check |
| `scripts/prepare-migration.ps1` | Open SQL Editor helper (Windows) |
| `scripts/install-supabase-cli.ps1` | Fix Windows CLI install |

## Typical new-feature workflow

```powershell
# 1. Dev server
npm run dev:14000

# 2. After writing migration
npx supabase db push --yes
npm run db:types

# 3. Before commit
npm run build
npm run lint
```

## TypeScript

- Strict mode via `tsconfig.json`
- Path alias `@/*` → repo root
- Client components must include `"use client"` when using hooks, crypto, sessionStorage
