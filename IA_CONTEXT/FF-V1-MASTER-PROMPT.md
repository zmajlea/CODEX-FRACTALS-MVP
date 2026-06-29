# Financial Firefighter V1 — Master Prompt for Cursor

**Copy everything below the line into Cursor Composer (Normal or Architect mode).**

Read first: [`IA_CONTEXT/README.md`](./README.md) · UX reference: `c:\CODEX_FACTALS\FF-UX-UI-CONTEXT\FF_v1\` (Ana's HTML prototype).

---

## COPY FROM HERE ↓

### Context & Objective

You are a **Staff-level Next.js and Supabase developer** adding a new product module **"Financial Firefighter V1" (FF V1)** to the existing **CODEX-FRACTALS-MVP** repository.

**Product:** A white-labeled, multi-tenant **manual** business-continuity wizard for CPA firms (distributors) and their end clients. No AI extraction in this module.

**Repo root:** `c:\CODEX_FACTALS\CODEX-FRACTALS-MVP\`  
**UX mockups (structure only):** `c:\CODEX_FACTALS\FF-UX-UI-CONTEXT\FF_v1\index.html`, `shared/app.js`, `shared/continuity.css`  
**Do NOT read or modify:** `app/(dashboard)/**` except shared `lib/`, `utils/`, `app/globals.css`, and `proxy.ts` extensions.

---

### Strict Architectural Rules (DO NOT DEVIATE)

| # | Rule |
|---|------|
| 1 | **Route isolation** — All FF V1 UI lives under `app/(tenant)/[domain]/`. Never add FF routes under `app/(dashboard)/`. |
| 2 | **Zero AI** — Do not import `/api/gemini-extract`, `@google/generative-ai`, or `lib/intelligence-lenses.ts` in FF code. |
| 3 | **E2E encryption** — Sensitive fields (contacts, notes, policies, advisor emails) MUST be encrypted **client-side** before Supabase. Server stores ciphertext only. |
| 4 | **Use existing crypto** — Import from `@/lib/encryption` only. Do not reimplement PBKDF2/AES-GCM. |
| 5 | **Design system** — Use tokens from `app/globals.css`: `--vellum`, `--obsidian`, `--cinnabar`, `--bone`, `--amber`, `--oxford`. No arbitrary Tailwind hex colors. |
| 6 | **Digital Vellum** — Calm, paper-like UI. Match `font-head` / `font-data` patterns from existing components. |
| 7 | **Supabase patterns** — Use `@/utils/supabase/client` (browser) and `@/utils/supabase/server` (RSC/API). Regenerate types after migrations: `npm run db:types`. |
| 8 | **Auth** — Reuse existing Supabase Auth + `proxy.ts` session refresh. Extend `proxy.ts` carefully; do not break `(dashboard)` protected routes. |

---

### Existing code you MUST reuse (do not hallucinate alternatives)

#### Encryption (client-only)

```ts
import {
  encryptStringWithPassword,
  decryptStringWithPassword,
  validateEncryptionKey,
  setVaultEncryptionKeyTest,
} from "@/lib/encryption";

import { getVaultSessionKey, setVaultSessionKey } from "@/lib/vault-session";
```

- Algorithm: PBKDF2-SHA256 (250k iter) + AES-GCM — see `lib/encryption-core.ts`
- Vault key in session: `sessionStorage["codexone_key_{vaultId}"]`
- Wire format: base64(salt + iv + ciphertext)

#### Sealing temporal objects (if FF stores continuity “pulses”)

Follow **`lib/temporal/seal-pulse.ts`** or **`lib/temporal/seal-batch.ts`**:

- Encrypt `title_ciphertext`, `body_ciphertext`, `explanation_ciphertext`, `qualifier_ciphertext`
- Set `verified_at` + `verified_by` on seal
- Plaintext metadata allowed: `category`, `parsed_date`, `event_type` (see `IA_CONTEXT/06-security-e2e-encryption.md`)

For FF labels use **`lib/temporal/event-types.ts`** (`EVENT_TYPES`, `composeLabel`, `validateComposedLabel`) if reusing pulse model.

#### Vault creation

Use existing RPC: `supabase.rpc("create_vault", { p_name })` — see migration `20260530140000_fix_vault_create_rls.sql`.

#### Invites (already exists)

Table **`vault_invites`** exists in `20260605120000_release1_schema.sql` (`vault_id`, `email`, `role`, `status`). **Extend** this table or add FF-specific invite metadata — do not duplicate blindly.

#### Site URL / OAuth

Use `getSiteUrl()` from `lib/site-url.ts` for invite links and redirects.

---

### What NOT to build

- ❌ New encryption utilities (`crypto-js`, custom AES wrappers, server-side decrypt of vault content)
- ❌ FF pages inside `(dashboard)` or changes to `DashboardShell`, `Switchboard`, `NautilusGrid`
- ❌ Gemini / LLM calls anywhere in FF
- ❌ Plaintext storage of contacts, notes, or advisor details in Postgres
- ❌ New global CSS theme files — extend `globals.css` tokens only if needed
- ❌ Firebase (listed in package.json but unused in MVP)

---

### Resolved decisions (product owner)

**Phase 5 — Option A (approved):** Trusted Advisor **emails, names, and roles** are stored as **plaintext / server-readable metadata** (extend `vault_invites` or add `ff_trusted_advisors`). The server may send transactional and emergency emails to these addresses. **All financial data and private notes remain strictly E2E encrypted** — the server never decrypts vault session content.

**Phase 5 protocol activation:** Server reads plaintext advisor emails from DB, sends emergency notification with **non-sensitive summary only** (client name, firm name, link). Full continuity packet stays encrypted; optional client-side decrypt + export is out of scope for V1 API.

### Ambiguity — STOP and ask the user (remaining)

1. ~~Phase 5 E2E collision~~ — **Resolved: Option A above.**

2. **FF data model** — Store section payloads in `ff_continuity_sections` with `payload_ciphertext` per section; status on `vaults.ff_status`. Trusted advisors in `ff_trusted_advisors` (plaintext contact fields).

3. **Subdomain production** — Dev uses path `/[domain]/...`; production subdomain rewrite in `proxy.ts` when host matches `*.fractals.com`.

---

### Phase 1: Database & Billing Schema

Create migration: `supabase/migrations/YYYYMMDDHHMMSS_ff_v1_tenants_billing.sql`

#### `tenants`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `name` | text NOT NULL | Firm display name |
| `subdomain` | text UNIQUE NOT NULL | e.g. `smithcpa` → `smithcpa.fractals.com` |
| `logo_url` | text | Public URL (not E2E) |
| `brand_color_hex` | text | e.g. `#E67E50` — overrides `--cinnabar` |
| `available_credits` | int NOT NULL DEFAULT 0 | Seat credits |
| `created_at` / `updated_at` | timestamptz | Standard |

#### `credit_transactions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK → tenants | |
| `amount` | int NOT NULL | Negative = spend, positive = purchase |
| `action` | text NOT NULL | e.g. `seat_provisioned`, `purchase`, `invite_sent` |
| `metadata` | jsonb DEFAULT `{}` | vault_id, invite_id, etc. |
| `created_at` | timestamptz | |

#### `vaults` alteration

```sql
alter table public.vaults
  add column if not exists tenant_id uuid references public.tenants (id);
```

Optional FF status on vault (plaintext for CPA dashboard):

```sql
-- e.g. ff_status: 'unstarted' | 'in_progress' | 'sealed'
```

#### RLS (sketch)

- **Vault members** — existing policies unchanged; members see their vaults.
- **Tenant admins** — new role mapping table OR use `vault_members.role = 'ADMIN'` scoped by `tenants` + link CPA user to `tenant_id`. Tenant admins SELECT vaults WHERE `vaults.tenant_id = their_tenant`.
- **Credits** — only tenant admins can UPDATE `tenants.available_credits` (use RPC `provision_client_seat(tenant_id)` with transaction).

After migration:

```powershell
npx supabase db push --yes
npm run db:types
```

Update `IA_CONTEXT/07-database-schema.md` if you touch schema docs.

---

### Phase 2: Subdomain Routing & White-Labeling

#### Extend `proxy.ts` (do not replace)

1. Parse `request.headers.get("host")`.
2. If host matches `{subdomain}.fractals.com` (or `{subdomain}.localhost` in dev), resolve `subdomain` → lookup `tenants.subdomain`.
3. Rewrite internally to `/[domain]/...` OR set header `x-ff-tenant-domain` for `(tenant)` layout.
4. **Do not** break existing matchers for `/switchboard`, `/vault`, `/login`.

#### Routes to create

```
app/(tenant)/[domain]/
  layout.tsx      # Fetch tenant by subdomain param; white-label header
  page.tsx        # Landing / redirect to wizard or admin
  admin/page.tsx  # Phase 3
  wizard/page.tsx # Phase 4
```

#### `layout.tsx` requirements

- Server: fetch tenant by `domain` param from Supabase (public fields: name, logo_url, brand_color_hex).
- Inject inline `<style>:root { --cinnabar: ${brand_color_hex}; }</style>` (only override brand accent).
- Header: tenant `logo_url` + name; **no** `DashboardShell` / `CodexRails`.
- Children: FF-specific minimal chrome (reference `FF_v1` topbar in `shared/app.js`).

---

### Phase 3: Distributor (CPA) Dashboard

**File:** `app/(tenant)/[domain]/admin/page.tsx`

Reference mockup sections in `FF-UX-UI-CONTEXT/FF_v1/shared/app.js` (CPA/distributor views if present) and general firm-admin patterns.

**UI requirements:**

1. **Credits banner** — `available_credits` large at top.
2. **Client vault table** — vaults WHERE `tenant_id` matches; columns: client name, `ff_status` (Unstarted / In Progress / Sealed), last activity.
3. **Invite Client** button:
   - Confirm credit ≥ 1
   - RPC or transaction: decrement `available_credits`, insert `credit_transactions` (`action: 'seat_provisioned'`, `amount: -1`)
   - `create_vault` or link to new vault with `tenant_id`
   - Create row in `vault_invites` (extend if needed) with secure token link
   - Return invite URL: `${getSiteUrl(origin)}/${domain}/wizard?invite={token}`

**Auth:** CPA must be authenticated Supabase user linked to tenant admin role.

---

### Phase 4: End-User Wizard & Sealing UI

**File:** `app/(tenant)/[domain]/wizard/page.tsx`

**Structural reference:** `FF-UX-UI-CONTEXT/FF_v1/shared/app.js` — 12 sections (`SECTIONS` array): People, Advisors, Documents, etc. Implement as multi-step wizard (not a SPA clone of the prototype).

**Form behavior:**

- Manual entry only — text inputs, contacts, notes.
- On blur or step save: encrypt field groups client-side with vault session key before persisting.
- Store encrypted payloads in DB (design: per-section ciphertext column or temporal_objects per section).

**Seal button state machine:**

```ts
type SealPhase = 'idle' | 'sealing' | 'sealed';
```

**On Seal click:**

1. Validate required fields (contacts, key advisors, etc.).
2. `setSealPhase('sealing')`.
3. Encrypt full payload via `encryptStringWithPassword(JSON.stringify(payload), sessionKey)`.
4. Supabase INSERT/UPDATE — set `verified_at = now()` on continuity record / temporal_objects.
5. `setSealPhase('sealed')`.
6. Trigger **FF Approved** stamp animation — reference `FF_v1/index.html` `#sealfx`, `.wax`, scale-down + opacity (port to React + `globals.css` or module CSS using `--cinnabar` / `--bone`).

Reuse visual language from `components/HankoSeal.tsx` where appropriate; FF uses wax shield stamp per mockup.

**Copy tone:** “Preparation is an act of love.” (from mockup `#sealcap`)

---

### Phase 5: Viral Loop & Emergency Hooks

#### A. `app/api/invites/send/route.ts`

- **POST** — authenticated user adds Trusted Advisor in wizard UI.
- Persist advisor **name, email, role** as **plaintext** in `ff_trusted_advisors` (server-readable for email delivery).
- Send transactional email via Resend (`RESEND_API_KEY`) or log to console in dev if key missing.
- Email: “You have been added as a trusted advisor on a continuity record for {client}.”
- Do not attach or include decrypted vault content.

#### B. `app/api/protocol/activate/route.ts`

- Emergency trigger from wizard (red control, confirm modal).
- **Option A (approved):** Load plaintext advisor rows from `ff_trusted_advisors` for the vault; send emergency email via Resend/SendGrid with non-sensitive copy only (no decrypted financial data).
- Log `record_activity_events` with `event_type: 'protocol_activated'`.
- Never decrypt `payload_ciphertext` or vault session content on the server.

---

### Implementation order

Execute phases **1 → 2 → 3 → 4 → 5** sequentially. After each phase:

```powershell
npm run build
npm run lint
```

Stop after Phase 1 for migration review if `db push` fails (use `npx supabase migration repair` per `IA_CONTEXT/08-supabase-cli.md`).

---

### File checklist (expected new files)

```
supabase/migrations/*_ff_v1_tenants_billing.sql
app/(tenant)/[domain]/layout.tsx
app/(tenant)/[domain]/page.tsx
app/(tenant)/[domain]/admin/page.tsx
app/(tenant)/[domain]/wizard/page.tsx
lib/ff/tenant-fetch.ts          # optional helper
lib/ff/provision-seat.ts        # credit + vault + invite RPC wrapper
app/api/invites/send/route.ts
app/api/protocol/activate/route.ts
components/ff/                  # FF-only UI (SealStamp, WizardStep, etc.)
```

---

### Testing

1. `npm run dev:14000`
2. Local tenant: seed a row in `tenants` with `subdomain = 'demo'`
3. Visit `http://localhost:14000/demo/admin` (or subdomain strategy you implement)
4. Verify encrypt/decrypt round-trip with vault key before seal
5. Confirm `(dashboard)/switchboard` still works unchanged

---

## END OF MASTER PROMPT ↑

---

## Maintainer notes (do not paste into Composer)

- Link this file from `IA_CONTEXT/README.md` when starting FF work.
- After FF ships, add `IA_CONTEXT/18-ff-v1-module.md` with as-built schema and routes.
- Randall features baked in: credits, CPA dashboard, invite flow, FF Approved stamp, protocol activation (pending E2E design).
