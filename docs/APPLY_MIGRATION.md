# Apply Supabase migration (Fractals MVP)

Project ref: **`tswdwmtrirdhtwqmsasz`**  
Migration file: `supabase/migrations/20260530000000_initial_schema.sql`

---

## Option A — SQL Editor (fastest, ~2 minutes)

1. Open **[SQL Editor → New query](https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz/sql/new)** (log in if prompted).

2. Open `supabase/migrations/20260530000000_initial_schema.sql` in this repo, select all, copy.

3. Paste into the editor and click **Run** (or `Ctrl+Enter`).

4. Confirm success: green “Success” with no errors. Expected objects:
   - Enums: `user_role`, `record_status`, `temporal_object_kind`
   - Tables: `users`, `vaults`, `vault_members`, `records`, `files`, `temporal_objects`
   - RLS enabled on all six tables
   - Triggers: `on_auth_user_created`, `on_vault_created`

5. Verify from the project root:

   ```powershell
   node scripts/verify-schema.mjs
   ```

   You should see six checkmarks. Empty tables are fine; “relation does not exist” means the migration did not run.

---

## Option B — Supabase CLI (repeatable deploys)

### One-time setup

1. Create an access token: [Account → Access tokens](https://supabase.com/dashboard/account/tokens).

2. In PowerShell (project root):

   ```powershell
   $env:SUPABASE_ACCESS_TOKEN = "sbp_...."   # your token
   npx supabase link --project-ref tswdwmtrirdhtwqmsasz
   ```

   Enter your **database password** when prompted (Project Settings → Database).

3. Optional: store password for CI:

   ```powershell
   $env:SUPABASE_DB_PASSWORD = "your-db-password"
   ```

### Push migration

```powershell
npx supabase db push
```

### Verify

```powershell
node scripts/verify-schema.mjs
```

---

## Option C — Table Editor sanity check

1. [Table Editor](https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz/editor)  
2. Confirm `public` schema lists all six tables.  
3. Open **Authentication → Policies** on any table and confirm RLS policies exist.

---

## Regenerate TypeScript types (after schema changes)

```powershell
$env:SUPABASE_ACCESS_TOKEN = "sbp_...."
npx supabase gen types typescript --project-id tswdwmtrirdhtwqmsasz > lib/database.types.ts
```

---

## Option D — `npm run db:apply` (Windows)

1. [Database → Connection string](https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz/settings/database) → **Session** mode → copy URI.
2. Paste into `.env.local` as `DATABASE_URL=...` (password is already URL-encoded in the copied string).
3. Quote `SUPABASE_DB_PASSWORD` if it contains `#`: `SUPABASE_DB_PASSWORD="your-password"`.
4. Run:

   ```powershell
   npm run db:apply
   npm run db:verify
   ```

| Error | Fix |
|-------|-----|
| `getaddrinfo ENOTFOUND db.*.supabase.co` | Direct host is often IPv6-only; use **Session pooler** URI (Option D). |
| `Tenant or user not found` on pooler | Wrong region or password; use the exact URI from the dashboard, not guessed regions. |
| `Node.js 20 … WebSocket` on `db:verify` | Fixed: verify uses REST `fetch` (pull latest `scripts/verify-schema.mjs`). |
| `new row violates row-level security policy` on vault create | Run `supabase/migrations/20260530140000_fix_vault_create_rls.sql` in SQL Editor (adds `create_vault` RPC + select policy). |
| `relation "public.vault_members" does not exist` at line ~53 | RLS helpers moved after `vault_members` in migration. Run `scripts/reset-partial-schema.sql`, then re-paste the full migration. |
| `type "user_role" already exists` | Migration already applied (or partial reset needed); run `verify-schema.mjs` or `reset-partial-schema.sql` first. |
| `permission denied for schema auth` | Run the full script as one batch in SQL Editor (includes `auth.users` trigger). |
| `verify-schema` shows “relation does not exist” | Re-run Option A; check correct project in dashboard URL. |
| CLI “Access token not provided” | Set `SUPABASE_ACCESS_TOKEN` or run `npx supabase login`. |

---

## What this migration does

- **E2E-ready columns**: `*_ciphertext` on records/files/temporal_objects; server never sees plaintext.
- **RBAC**: `vault_members` + `is_vault_member()` / `is_vault_admin()` for RLS.
- **Auth sync**: new sign-ups get a row in `public.users`.
- **Vault bootstrap**: creating a vault adds creator as `SUPER_ADMIN` in `vault_members`.
