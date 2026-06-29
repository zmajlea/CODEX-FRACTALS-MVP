# 10 — Environment Variables

Create **`.env.local`** in `CODEX-FRACTALS-MVP/` (gitignored). Never commit this file.

## Template

```env
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

# Server-only (optional unless using admin scripts)
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...

# Gemini extraction (required for extract flow)
GOOGLE_GENAI_API_KEY=...

# Database direct access (optional — migration scripts)
SUPABASE_DB_PASSWORD=...
DATABASE_URL=postgresql://postgres:...@db.YOUR_PROJECT_REF.supabase.co:5432/postgres

# Site URL (local dev only — do NOT use localhost in Vercel Production)
NEXT_PUBLIC_SITE_URL=http://localhost:14000

# Supabase CLI (optional, for CI/automation)
SUPABASE_ACCESS_TOKEN=sbp_...
```

## Variable reference

| Variable | Client-safe? | Purpose |
|----------|--------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase API endpoint |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Anon key for browser + SSR |
| `SUPABASE_SERVICE_ROLE_KEY` | **No** | Bypass RLS — server/scripts only |
| `GOOGLE_GENAI_API_KEY` | **No** | Gemini in API route only |
| `SUPABASE_DB_PASSWORD` | **No** | CLI link + pg scripts |
| `DATABASE_URL` | **No** | `apply-migration-pg.mjs` |
| `NEXT_PUBLIC_SITE_URL` | Yes | OAuth redirect fallback |
| `SUPABASE_ACCESS_TOKEN` | **No** | CLI non-interactive auth |

## Where keys come from

| Key | Location |
|-----|----------|
| Supabase URL + anon key | Dashboard → Project Settings → API |
| Service role | Same page (keep secret) |
| DB password | Project Settings → Database |
| Gemini | [Google AI Studio](https://aistudio.google.com/apikey) |
| Access token | [Account tokens](https://supabase.com/dashboard/account/tokens) |

## Loading in scripts

Node scripts use `scripts/load-env.mjs`:

```js
import { loadEnvLocal } from "./load-env.mjs";
loadEnvLocal(resolve(__dirname, "../.env.local"));
```

## Vercel

Mirror `NEXT_PUBLIC_*` and `GOOGLE_GENAI_API_KEY` in Vercel dashboard. Do not upload `.env.local` to git.

## Seed scripts

`scripts/seed-journey-test.mjs` and `scripts/seed-exakom-vault.mjs` read Supabase keys from `.env.local` and sign in with hardcoded or env-based test users — see [16-testing-and-seeding.md](./16-testing-and-seeding.md).
