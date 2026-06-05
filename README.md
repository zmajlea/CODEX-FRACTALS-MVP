This is the **CodexOne / Fractals MVP** — Next.js + Supabase + E2E encryption.

## Database migration

Apply the schema once before using vaults/records:

1. **Quick path:** `.\scripts\prepare-migration.ps1` (copies SQL, opens Supabase SQL Editor — paste and Run).
2. **Full guide:** [docs/APPLY_MIGRATION.md](docs/APPLY_MIGRATION.md)
3. **Verify:** `npm run db:verify`
4. **Storage (for E2E uploads):** paste `supabase/migrations/20260530120000_storage_vault_files.sql` in SQL Editor → Run

CLI (after login): `npm run db:push`

**Supabase CLI on Windows:** run commands from this folder (`CODEX-FRACTALS-MVP`), not the parent repo root:

```powershell
cd c:\CODEX_FACTALS\CODEX-FRACTALS-MVP
.\scripts\install-supabase-cli.ps1   # if `npx supabase` says supabase-go missing
npm run supabase:login
```

If install still fails: `npm install -g supabase` then `supabase login`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:14000](http://localhost:14000) — redirects to `/switchboard` when signed in.

### Release 1 routes (`app/(dashboard)/`)

| Route | Surface |
|-------|---------|
| `/switchboard` | S1 Gateway + Results Mode drawer |
| `/vault/[vaultId]` | S3 Record Home (dual readouts) |
| `/vault/[vaultId]/ingest` | S3A Ingestion Pipeline |
| `/vault/[vaultId]/extract` | Temporal Extraction Engine |
| `/vault/[vaultId]/settings` | S10 Record Settings |
| `/profile` | S11 Profile Settings |
| `/portfolio` | Redirects to `/switchboard?results=1` |

**Test plans:** [docs/test-scenarios.md](docs/test-scenarios.md) (quick) · [docs/test-scenarios-release1.md](docs/test-scenarios-release1.md) (Journeys 1–10)

### Phase 2 — Airlock & Switchboard

- `/login`, `/signup` — Supabase Auth (email + **Continue with Google**)
- `/auth/callback` — OAuth session exchange
- `/switchboard` — vault cards (Amber = locked, Emerald = unlocked), encryption key modal, E2E file upload

### Phase 3 — Temporal Extraction Engine

- `/vault/[vaultId]/extract` — Intelligence Lenses + Gemini extraction + Triage Inspector
- `POST /api/gemini-extract` — server-side Gemini (requires `GOOGLE_GENAI_API_KEY` in `.env.local`)
- **Seal Batch** — E2E encrypts title/body/explanation → `temporal_objects` (`parsed_date`, `category` plaintext)

Run migration: `supabase/migrations/20260530160000_temporal_objects_queryable.sql`

### Google OAuth setup

1. [Google Cloud Console](https://console.cloud.google.com/) → OAuth client (Web) → redirect URI:
   `https://tswdwmtrirdhtwqmsasz.supabase.co/auth/v1/callback`
2. [Supabase → Auth → Providers → Google](https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz/auth/providers) — paste Client ID + Secret
3. **Auth URL config (CLI)** — from repo root after `supabase login` + link:
   ```bash
   npm run auth:config:push
   ```
   This reads `supabase/config.toml` (`[auth]` site_url + redirect URLs) and pushes to project `tswdwmtrirdhtwqmsasz`. Or use the [dashboard URL Configuration](https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz/auth/url-configuration) instead.
4. **Vercel → Environment Variables (Production):** remove `NEXT_PUBLIC_SITE_URL` or set it to `https://codex-fractals-mvp.vercel.app`. Never use `http://localhost:14000` in Production.
5. Redeploy after changing env vars. Google sign-in uses `/api/auth/google` on the same host you opened (Vercel forwarded headers).

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
