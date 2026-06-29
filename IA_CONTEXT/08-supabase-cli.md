# 08 — Supabase CLI

All commands run from **`CODEX-FRACTALS-MVP/`**.

## One-time setup

### 1. Install CLI

```powershell
cd c:\CODEX_FACTALS\CODEX-FRACTALS-MVP
.\scripts\install-supabase-cli.ps1   # Windows helper
# or: npm install -g supabase
```

### 2. Login

```powershell
npm run supabase:login
# or: npx supabase login
```

Creates access token at [Account → Access tokens](https://supabase.com/dashboard/account/tokens).

### 3. Link project

```powershell
npx supabase link --project-ref tswdwmtrirdhtwqmsasz
```

Enter **database password** when prompted (Dashboard → Project Settings → Database).

Optional for scripts:

```powershell
$env:SUPABASE_ACCESS_TOKEN = "sbp_...."
$env:SUPABASE_DB_PASSWORD = "your-db-password"
```

## Daily commands

| Command | Purpose |
|---------|---------|
| `npm run db:push` | Apply pending migrations to remote |
| `npm run db:types` | Regenerate `lib/database.types.ts` |
| `npm run db:verify` | Check tables exist |
| `npm run db:query` | Run SQL via linked project |
| `npm run auth:config:push` | Push `supabase/config.toml` auth URLs |

### Push migrations (non-interactive)

```powershell
npx supabase db push --yes
```

## Migration history out of sync

If remote DB was created via SQL Editor but CLI shows empty "Remote" column:

```powershell
# Mark already-applied migrations
npx supabase migration repair 20260530000000 20260530120000 ... --status applied --linked

# Then push only new ones
npx supabase db push --yes
```

Check status:

```powershell
npx supabase migration list --linked
```

Local and Remote columns should match.

## Auth config (`supabase/config.toml`)

```toml
project_id = "tswdwmtrirdhtwqmsasz"

[auth]
site_url = "https://codex-fractals-mvp.vercel.app"
additional_redirect_urls = [
  "https://codex-fractals-mvp.vercel.app/**",
  "http://localhost:14000/**",
]
```

After changing URLs:

```powershell
npm run auth:config:push
```

## Fallback: direct SQL

If `db push` fails or direct host DNS fails:

1. Paste migration SQL in [SQL Editor](https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz/sql/new)
2. Or use `npm run db:apply` with `DATABASE_URL` (Session pooler) in `.env.local`

See `docs/APPLY_MIGRATION.md` and `scripts/apply-migration-pg.mjs`.

## Storage

Bucket `vault-files` — policies in `20260530120000_storage_vault_files.sql`. Required for encrypted uploads.

## Dashboard links

| Area | URL |
|------|-----|
| SQL Editor | https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz/sql |
| Auth Users | https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz/auth/users |
| Auth Providers | https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz/auth/providers |
| Storage | https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz/storage/buckets |
