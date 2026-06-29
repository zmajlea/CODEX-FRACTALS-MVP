# 07 — Database Schema

## Project

- **Ref:** `tswdwmtrirdhtwqmsasz`
- **Migrations:** `supabase/migrations/` (apply in filename order)

## Migration history

| File | Purpose |
|------|---------|
| `20260530000000_initial_schema.sql` | Core enums, users, vaults, records, files, temporal_objects, RLS |
| `20260530120000_storage_vault_files.sql` | Storage bucket `vault-files` |
| `20260530140000_fix_vault_create_rls.sql` | `create_vault` RPC + policies |
| `20260530160000_temporal_objects_queryable.sql` | `parsed_date`, `category`, `explanation_ciphertext`, indexes |
| `20260605120000_release1_schema.sql` | Activity, invites, inbox, ingestion, versions, alerts |
| `20260606120000_temporal_event_type_qualifier.sql` | `event_type`, `qualifier_ciphertext` |

## Core tables

### `vaults`

Record containers. `encryption_test` = E2E validation blob.

### `vault_members`

RBAC: user ↔ vault, role enum `user_role`.

### `records`

Logical record inside vault (e.g. "Inbox"). `title_plain` is non-sensitive.

### `files`

Encrypted uploads. `storage_path`, `file_name_ciphertext`, `mime_type`.

### `temporal_objects` (pulses)

| Column | Encrypted? | Notes |
|--------|------------|-------|
| `title_ciphertext` | Yes | Composed label `eventType - qualifier` |
| `qualifier_ciphertext` | Yes | Qualifier alone |
| `body_ciphertext` | Yes | Source clause or ISO date |
| `explanation_ciphertext` | Yes | AI rationale |
| `event_type` | No | Controlled vocabulary |
| `parsed_date` | No | ISO date for timeline |
| `category` | No | Date, Obligation, etc. |
| `verified_at` | No | NULL = unsealed, set = sealed |

### Release 1 tables

- `record_activity_events` — audit log
- `vault_invites` — invite lifecycle
- `inbox_items` — inbox surface
- `ingestion_jobs` / `ingestion_files` — pipeline tracking
- `temporal_object_versions` — revisioning
- `alerts` — alert shell

## Key RPC

```sql
create_vault(p_name text)  -- creates vault + vault_members row for caller
```

## TypeScript types

Generated into `lib/database.types.ts`:

```powershell
npm run db:types
# equivalent: npx supabase gen types typescript --project-id tswdwmtrirdhtwqmsasz
```

## Verify schema

```powershell
npm run db:verify
```

See also: `docs/APPLY_MIGRATION.md`
