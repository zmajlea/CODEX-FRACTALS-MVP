# Fractals MVP — Release 1 Test Scenarios (Journeys 1–10)

Manual + Cursor browser MCP test plan for **ship-ready** user journeys and canonical surfaces (S1–S12).

**Base URL:** `http://localhost:14000`  
**Quick seed:** `npm run test:seed`  
**Dev server:** `npm run dev:14000`

See also: [test-scenarios.md](./test-scenarios.md) for the condensed smoke log and seed credentials.

---

## How to use this document

Each journey section includes:

1. **Intent** — what the user is trying to accomplish (plain language)
2. **Surfaces** — screens/rails touched (S1–S12)
3. **End-to-end flow** — narrative walkthrough
4. **Test steps** — actionable table (Action → Expected)
5. **Definition of done** — “must be true” invariants from the canonical spec
6. **MVP status** — what is wired today vs shell/partial

**Global invariants** (check on every journey):

| Invariant | How to verify |
|-----------|----------------|
| No chat UI | No transcript/thread anywhere |
| Low-entropy lists | Ledger, Results drawer, queues: title + date + category + vault tag only — no body/evidence |
| Evidence in Inspector only | Open list row → body appears only in Inspector |
| Return-to-place | Close Inspector / Settings / Inbox / Alerts → prior surface preserved |
| E2E encryption | Upload + `temporal_objects` ciphertext fields; server sees ciphertext only |
| S12 gating | Hidden \| Disabled+reason \| Error-on-attempt (see `lib/gating.ts`) |

---

## Surface map → routes

| Surface | Route / entry | Key features to test |
|---------|---------------|----------------------|
| **S1** Gateway / Results Mode | `/switchboard`, `/portfolio` → `?results=1` | Cards, unlock posture, Results drawer, scope chips, sequestered Inspector |
| **S2** Active Record Handshake | Vault key modal on card click / deep-link | Allowed vs Blocked entry; no cross-record bleed |
| **S3** Record Home | `/vault/[vaultId]` | Nautilus + ledger sync, sealed at rest, Query, queues |
| **S3A** Ingestion | `/vault/[vaultId]/ingest` | PDF upload, scan mode, job status |
| **S4** Query | Bottom bar on Record Home | Idle → Running → Identifying → Completed / Failed |
| **S5** Focus | Record Home keyboard | ↑/↓ focus, Enter → Inspector, Esc clears focus |
| **S6** Inspector | Overlay on Record Home / Results | Clean / Original / History; seal; evidence policy |
| **S7** Seal | Inspector sub-state | Preconditions, in-progress, success, activity log event |
| **S8** Recall | Query on sealed pulse | Exact match returns existing sealed pulse (dedupe) |
| **S9** Alerts | Alerts panel (rail) | List/create; sealed-only targets |
| **S10** Record Settings | `/vault/[vaultId]/settings` | Identity, key posture, members, invites, activity log entry |
| **S11** Profile Settings | `/profile` | Identity, authorities shell, User Audit Log |
| **S12** Governance | Cross-cutting | Invite lifecycle, role gates, audit emission |

**Global rails:** Top header (`CodexRails`) + left side panel — Switchboard, Security, Ingestion, Inbox, Profile, Record Settings, Sign out.

---

## Seed data

### Automated (Journeys 1, 3)

```powershell
cd c:\CODEX_FACTALS\CODEX-FRACTALS-MVP
npm run test:seed
```

| Field | Value |
|-------|-------|
| Email | `journey1-test@codexone.test` |
| Password | `Journey1Test!2026` |
| Vault 1 | `Journey1 Test Record` / `44d60a55-26c0-4db5-a6c8-db85f1d83de9` / key `Journey1VaultKey!` |
| Vault 2 | `Journey3 Second Record` / `9c726bd9-c3a3-4fd7-b84a-2c8f29df6994` / key `Journey3VaultKey!` |
| Pulses | **Effective Date** (sealed), **Renewal Date** (unsealed after seed), **Closing Date** on vault 2 (sealed) |

Re-run seed to reset **Renewal Date** to unsealed for Journey 1 seal tests.

### Manual seed (Journeys 4, 6, 10)

**Second test user (invitee)** — create in Supabase Auth or sign up at `/signup`:

- Email: `journey4-invitee@codexone.test`
- Password: `Journey4Invitee!2026`

**Inbox item (Journey 6)** — after admin sends invite, or insert manually:

```sql
INSERT INTO inbox_items (user_id, item_type, title_plain, deep_link)
VALUES (
  '<invitee-user-uuid>',
  'vault_invite',
  'Invite to Journey1 Test Record',
  '/vault/44d60a55-26c0-4db5-a6c8-db85f1d83de9/settings'
);
```

**Alert (Journey 10)** — requires sealed `pulse_id`:

```sql
INSERT INTO alerts (vault_id, pulse_id, schedule_at, status, created_by)
VALUES (
  '44d60a55-26c0-4db5-a6c8-db85f1d83de9',
  '<sealed-pulse-uuid>',
  now() + interval '7 days',
  'scheduled',
  '<admin-user-uuid>'
);
```

### Journey 2 assets

- **EXAKOM BUSINESS DEV** — `npm run test:seed:exakom` uploads CRM files from  
  `C:\Users\leander\Documents\Claude\Projects\Mailing EXAKOM` (PDF, CSV, MD, XLSX, DOCX, HTML).
- Vault key: `ExakomBusinessDev!2026` · see [test-scenarios.md](./test-scenarios.md#exakom-business-dev-journey-2--multi-format)
- Requires `GOOGLE_GENAI_API_KEY` in `.env.local` for extract

---

## Journey 1 — Query → Inspect → Seal → Recall

### Intent

Turn “maybe-true” into “true-with-responsibility” inside **one** Active Record. The core truthmaking loop.

### Surfaces

S2 Handshake → S3 Record Home → S4 Query → S5 Focus → S6 Inspector → S7 Seal → S8 Recall

### End-to-end flow

1. User unlocks a record on the Gateway and enters Record Home.
2. Sealed pulses (Bone) are visible at rest in Nautilus rings and ledger without hover.
3. User runs a query in the bottom bar (not a chat).
4. System surfaces Amber candidates in rings + ledger (dual readouts stay synced).
5. User focuses a candidate (↑/↓ or click), opens Inspector (Enter or double-click).
6. User reviews evidence in Inspector (Clean / Original / History); native pulses show “No evidence attached”.
7. User clicks **Seal Pulse** — explicit, irreversible responsibility transfer.
8. On success: pulse becomes sealed, attribution visible, `record_activity_events` emits `pulse_sealed`.
9. User closes Inspector; same query recalls the **existing** sealed pulse (no duplicate).

### Test steps

| # | Action | Expected |
|---|--------|----------|
| 1 | `/switchboard` → unlock vault → click card | `/vault/<id>`; handshake completes |
| 2 | Observe Record Home | Nautilus + ledger; sealed count in header |
| 3 | Query `Renewal` (slow type + Enter in query bar) | Candidates in ledger; query state completes |
| 4 | Click / ↑↓ to focus Renewal row | Focus syncs between ring and ledger |
| 5 | Double-click row or Enter (focus not in query input) | Inspector opens; tabs Clean / Original / History |
| 6 | Unsealed pulse → **Seal Pulse** | “Sealing…” → close; sealed count increments |
| 7 | Query `Effective` | Returns sealed match; Inspector shows **Anchored** / disabled seal |
| 8 | Inspect ledger row text | Date, category, title only — no body snippet |

### Definition of done

- [ ] Evidence never in list rows
- [ ] Sealed anchors operable without hover
- [ ] Seal attribution immediate in Inspector
- [ ] Record Activity Log discoverable (event `pulse_sealed`)
- [ ] Enter in query bar submits query (does not open Inspector)

### MVP status

| Area | Status |
|------|--------|
| Query states | Wired (`record-query.ts`) |
| Dual readouts + focus | Wired |
| Inspector + seal | Wired (`seal-pulse.ts` + activity event) |
| Activity log overlay | Partial — schema + insert; UI entry TBD |
| Doc Identifier / Full Scan queues | Shell on Record Home (empty stubs) |

---

## Journey 2 — Ingest PDFs → Extract → Inspect → Seal

### Intent

Drop PDFs into a record and get **sealable candidates** without structuring everything first. Value-first structuring.

### Surfaces

S3 Record Home → S3A Ingestion → Extract Engine → S3 queues → S6 Inspector → S7 Seal

### End-to-end flow

1. From Record Home, open **Ingestion Pipeline** (header or rail).
2. Choose scan mode: **Doc Identifier** (default) or **Full Scan**.
3. Upload PDF(s); files encrypt client-side before Supabase Storage.
4. Job + per-file status progresses (uploading → queued → scanning → complete / failed).
5. Open **Temporal Extraction Engine**; select file; run Gemini lens.
6. Review triage suggestions; batch-seal (Hanko) or seal individually in Inspector.
7. Return to Record Home — new pulses in Nautilus/ledger.
8. Optional: Doc Identifier Queue shows proposed doc metadata rows (approve / edit / dismiss).

### Test steps

| # | Action | Expected |
|---|--------|----------|
| 1 | `/vault/<id>/ingest` (vault unlocked) | Scan mode toggle; job status bar; Secure Upload |
| 2 | Toggle **Full Scan** | Mode highlight changes |
| 3 | Upload `docs/fixtures/sample-contract.pdf` | Client encrypt; storage row; job → complete |
| 4 | `/vault/<id>/extract` | File selector; Run extraction |
| 5 | Run extraction | Triage list or deterministic error message |
| 6 | Seal batch / single pulse | Encrypted `temporal_objects` rows |
| 7 | Record Home | New pulses visible; Journey 1 seal path works |

### Definition of done

- [ ] PDF-only scope enforced
- [ ] Per-file retry granularity (not per-page)
- [ ] Provenance tether in Inspector (doc name + location)
- [ ] Ingestion does **not** auto-propose revisions on upload
- [ ] Cancel job: Keep vs Discard when results exist (TBD in UI)

### MVP status

| Area | Status |
|------|--------|
| Ingest UI + upload | Wired (`VaultFileUpload`, E2E encrypt) |
| Job state machine | Partial — UI simulates complete after upload |
| Extract + Gemini | Wired; depends on API key + service availability |
| Queues on Record Home | Shell (`docProposals` / `fullScanRows` empty) |
| `ingestion_jobs` / `ingestion_files` tables | Schema exists; not fully wired to UI |

---

## Journey 3 — Cross-portfolio recall (Results Mode)

### Intent

Ask once, recall sealed truth **across** multiple unlocked records — without mixing sovereignty or contaminating ring state.

### Surfaces

S1 Gateway → Results Mode drawer → S6 Inspector (sequestered to owning record)

### End-to-end flow

1. On Gateway, unlock **2+** records (session keys).
2. Toggle **Results Mode ON** (explicit mode; header shows ON state).
3. Right drawer opens: time-forward ledger with **Now** marker; portfolio cards remain visible (dual readouts).
4. **Scope chips** toggle which unlocked records are included (eligible ≠ in-scope).
5. Timeline rows show record provenance (vault name tag); low-entropy only.
6. Click row → Inspector opens in **that record’s context** (sequestration).
7. Close Inspector → return to Results Mode; scope and scroll preserved.
8. `/portfolio` deep-link opens Gateway with Results Mode ON.

### Test steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Unlock vault 1 + vault 2 on Switchboard | “2 active records” |
| 2 | **Results Mode ON** | Drawer opens; cards still visible |
| 3 | Wait for load (or vaults loading) | Timeline shows Date pulses (not false empty) |
| 4 | Toggle scope chip (deselect one vault) | Timeline filters to in-scope vaults |
| 5 | Click **Closing Date** (vault 2) | Inspector: provenance = Journey3 Second Record |
| 6 | Close Inspector | Results Mode ON; drawer still open |
| 7 | Navigate `/portfolio` | Redirect `/switchboard?results=1` |

### Definition of done

- [ ] Results Mode is explicit ON/OFF
- [ ] Ledger rows: no evidence/confidence/narrative
- [ ] No ring contamination (portfolio highlight ≠ write to record rings)
- [ ] Inspector sequestered to owning record
- [ ] Return-to-place after Inspector close

### MVP status

| Area | Status |
|------|--------|
| Results drawer + timeline | Wired |
| Scope model | Wired (chips) |
| Sequestered Inspector | Wired |
| `/portfolio` redirect | Wired |
| Loading UX | Fixed — drawer waits for vault list load |

---

## Journey 4 — Governance: invite → accept/reject → revoke

### Intent

Safely add/remove people to a record with explicit roles, immediate enforcement, and auditable trails.

### Surfaces

S10 Record Settings → Inbox (S6 journey) → Record Activity Log + User Audit Log

### End-to-end flow

1. **Admin** opens Record Settings for an Active Record.
2. Admin invites by email with role (USER default); `vault_invites` row + `invite_sent` activity event.
3. Invitee receives **Inbox** item (or email in production).
4. Invitee accepts or rejects from Inbox (or Settings).
5. On accept: `vault_members` row created; invite status → `accepted`; audit events in both logs.
6. Admin revokes member or invite → immediate loss of access; status → `revoked`.

### Test steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Admin: `/vault/<id>/settings` | Members list; invite form |
| 2 | Invite `journey4-invitee@codexone.test` | Row in `vault_invites`; activity event |
| 3 | Non-admin user: same URL | **Disabled+reason** (“Admin role required”) |
| 4 | Invitee: open Inbox (rail) | Unread invite item |
| 5 | Invitee: accept invite | Membership active; invite `accepted` |
| 6 | Admin: revoke member | Access removed immediately; audit event |
| 7 | Revoked user: open record | Blocked handshake or error |

### Definition of done

- [ ] Single gating contract on all governance actions
- [ ] Invite lifecycle: pending → accepted \| rejected \| revoked
- [ ] Append-only audit in Record + User logs
- [ ] Resend invite: pending-only, no duplicate object (TBD)

### MVP status

| Area | Status |
|------|--------|
| Record Settings + invite insert | Wired |
| Role gate (non-admin) | Wired (`resolveGate`) |
| Inbox display + deep-link | Wired (read/mark-read) |
| Accept / reject / revoke UI | **Not wired** — manual SQL or next pass |
| `vault_members` on accept | **Not wired** — needs accept handler |

---

## Journey 5 — Revisioning: sealed → draft → reseal

### Intent

Correct truth without breaking integrity: history preserved, **one canonical** sealed version at all times.

### Surfaces

S6 Inspector (History tab) → seal/break-seal → audit logs

### End-to-end flow

1. Open a **sealed** pulse in Inspector.
2. Switch to **History** — version list from `temporal_object_versions`.
3. Create **Draft Version** linked to sealed pulse.
4. Edit draft fields; mark ready for seal.
5. **Apply revision** atomically: old canonical → non-canonical; new draft → canonical sealed.
6. History shows both versions; only one `is_canonical`.

### Test steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Inspector on sealed pulse → **History** | Version list or empty state message |
| 2 | Create draft version | New row in `temporal_object_versions` |
| 3 | Edit draft in Inspector | Draft ciphertext updated |
| 4 | Apply revision / reseal | Atomic canonical swap; no “no truth” gap |
| 5 | History tab | Old version non-canonical; new canonical |
| 6 | Break seal (if exposed) | Explicit confirmation; gated by role |

### Definition of done

- [ ] No moment without canonical truth (atomic apply)
- [ ] Break seal requires confirmation + permission gate
- [ ] History tab is source of truth for versions

### MVP status

| Area | Status |
|------|--------|
| `temporal_object_versions` schema | Wired |
| `fetchPulseVersions` | Wired |
| Inspector History tab | Wired (read-only list) |
| Draft create / apply revision UI | **Not wired** |
| Break-seal flow | **Not wired** |

---

## Journey 6 — Notifications Inbox

### Intent

Handle system items without chat; every item deep-links to the canonical surface.

### Surfaces

Inbox side panel (rail) → deep routes (Settings, Inspector, Alerts, Logs)

### End-to-end flow

1. System emits event → `inbox_items` row with `item_type`, `title_plain`, `deep_link`.
2. User opens **Inbox** from rail (Unread default).
3. Actionable items (invites): act in place or follow deep-link.
4. Informational items: deep-link to Inspector / Settings / Alerts.
5. On success: mark read (`read_at` set); failures never silently resolve.

### Test steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Rail → **Inbox** | Panel slides in; unread list |
| 2 | Empty inbox | “No unread notifications” |
| 3 | Seed inbox item (SQL above) | Item appears with `item_type` label |
| 4 | Click item | `read_at` set; navigates to `deep_link` |
| 5 | Close panel | Return to prior surface |

### Definition of done

- [ ] No chat transcript
- [ ] Deterministic deep-links
- [ ] Read state persisted
- [ ] Invite actions auditable

### MVP status

| Area | Status |
|------|--------|
| Inbox panel + fetch unread | Wired |
| Mark read on open | Wired |
| Invite accept/reject in inbox | **Not wired** |
| Unread badge on rail | Stub (`inboxUnreadCount={0}`) |

---

## Journey 7 — Profile Settings

### Intent

Manage personal identity, authorities/delegations, and review a user-level audit trail.

### Surfaces

S11 Profile Settings → User Audit Log overlay

### End-to-end flow

1. Header/rail → **Profile**.
2. View identity (display name, email).
3. **Authorities**: Delegated by me / Granted to me — accept, reject, revoke delegations.
4. Open **User Audit Log** — append-only events with record context when applicable.

### Test steps

| # | Action | Expected |
|---|--------|----------|
| 1 | `/profile` | Identity section populated |
| 2 | Authorities section | Placeholder or delegation list |
| 3 | **View User Audit Log** | Toggle list; events or empty state |
| 4 | Perform gated action (e.g. seal) | Event appears in user audit (when wired) |

### Definition of done

- [ ] Two-directional authorities with auditable lifecycle
- [ ] User Audit Log overlay entry from Profile

### MVP status

| Area | Status |
|------|--------|
| Identity display | Wired |
| User Audit Log toggle | Wired (read) |
| Authorities CRUD | Shell (“future release pass”) |
| Audit emission on user actions | Partial |

---

## Journey 8 — Record Settings

### Intent

Govern the record as a sovereign container: identity, key posture, members, activity history.

### Surfaces

S10 Record Settings → Record Activity Log overlay

### End-to-end flow

1. Admin enters Record Settings from header (active record context).
2. View record identity, **key posture** (Active/Locked language).
3. Manage members/roles; send invites (Journey 4).
4. Open Record Activity Log — append-only vault events (`pulse_sealed`, `invite_sent`, …).
5. Non-admin: deterministic **Disabled+reason** (not hidden error).

### Test steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Unlock record → **Record Settings** in header | `/vault/<id>/settings` |
| 2 | Key posture section | “Active · Key in session” when unlocked |
| 3 | Members list | Creator + invited members with roles |
| 4 | Non-admin login → settings URL | Disabled message + back link |
| 5 | After Journey 1 seal | `pulse_sealed` in activity (SQL or future UI) |

### Definition of done

- [ ] Admin + Super Admin only; others Disabled+reason
- [ ] Key posture language accurate
- [ ] Activity log append-only entry point

### MVP status

| Area | Status |
|------|--------|
| Settings page + gate | Wired |
| Members + invite form | Wired |
| Key posture display | Wired |
| Record Activity Log UI | **Not wired** (events inserted on seal/invite) |

---

## Journey 9 — Send for signature + status (stretch)

### Intent

Execute agreement **signature** (legal act) distinct from **seal** (responsibility transfer); track lifecycle.

### Surfaces

In-record entry → `SignaturePanel` → Inbox mirror + Profile signature artifacts

### End-to-end flow

1. From record context, open **Send for Signature**.
2. Select parties / document; send email (production).
3. Track status: sent → viewed → signed / declined.
4. Inbox mirrors status changes.
5. Signature artifacts stored under Profile Settings (not mixed with seals).

### Test steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Open Signature panel (when entry wired) | Modal: “Signature ≠ Seal” copy |
| 2 | Shell message | Stretch goal notice |
| 3 | Close panel | Return to record |

### Definition of done

- [ ] Signature ≠ Seal semantics clear in UI
- [ ] Deterministic status lifecycle
- [ ] Inbox mirroring

### MVP status

| Area | Status |
|------|--------|
| `SignaturePanel` | Shell only |
| Email delivery + status | **Not wired** |

---

## Journey 10 — Alerts / milestones email

### Intent

Schedule reminders on **sealed** time-bound obligations; delivery audited; unsealed targets blocked.

### Surfaces

S9 Alerts panel → Inbox mirror → audit logs

### End-to-end flow

1. User selects a **sealed** milestone pulse.
2. Creates alert with schedule date.
3. System delivers email/reminder; records outcome (sent / failed / retry).
4. Unsealed pulse: alert creation **disabled** with reason → route to seal first.
5. If pulse unsealed via revision: alert → paused/blocked (never silent retarget).

### Test steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Open Alerts panel (active vault) | List or “sealed milestones only” empty |
| 2 | Seed alert (SQL) for sealed pulse | Row shows schedule + status |
| 3 | Attempt alert on unsealed pulse | Disabled / blocked with reason |
| 4 | Deep-link from Inbox reminder | Opens alert detail (when wired) |

### Definition of done

- [ ] Sealed-only scheduling enforced
- [ ] Delivery outcomes + retry auditable
- [ ] Paused on revision/unseal

### MVP status

| Area | Status |
|------|--------|
| `alerts` schema | Wired |
| Alerts panel (read list) | Wired |
| Create / edit / cancel UI | **Not wired** |
| Email delivery | **Not wired** |

---

## Cross-journey smoke matrix

Run after any release-impacting change:

| # | Journey | Smoke time | Blocker if fails |
|---|---------|------------|------------------|
| 1 | Query → Seal → Recall | ~3 min | Core product broken |
| 2 | Ingest → Extract | ~5 min | Needs PDF + Gemini |
| 3 | Results Mode | ~3 min | Portfolio value prop |
| 4 | Invite (admin gate) | ~2 min | Governance |
| 5 | History tab | ~1 min | Revisioning path |
| 6 | Inbox open + deep-link | ~1 min | Notifications |
| 7 | Profile + audit toggle | ~1 min | User trust |
| 8 | Settings + non-admin gate | ~2 min | Record sovereignty |
| 9 | Signature shell | ~30 sec | Stretch |
| 10 | Alerts list | ~1 min | Milestones |

---

## Cursor agent prompts

**Full Release 1 pass:**

```
Browser-test Journeys 1–10 on http://localhost:14000 using docs/test-scenarios-release1.md.
Run npm run test:seed first. Use journey1-test@codexone.test credentials.
Report PASS/PARTIAL/BLOCKED per journey with screenshots on failure.
Fix only regressions; document unimplemented items as MVP status gaps.
```

**Single journey:**

```
Browser-test Journey <N> on http://localhost:14000 per docs/test-scenarios-release1.md.
```

---

## Browser test log

| Date | Tester | J1 | J2 | J3 | J4 | J5 | J6 | J7 | J8 | J9 | J10 | Notes |
|------|--------|----|----|----|----|----|----|----|----|----|-----|-------|
| 2026-06-05 | Agent | PASS | PARTIAL | PASS | PARTIAL | PARTIAL | PASS | PARTIAL | PASS | — | — | Full browser run; see below |
| 2026-06-05 (earlier) | Agent | PASS | PARTIAL | PASS | — | — | — | — | — | — | — | Journeys 1–3 only |

### 2026-06-05 full run details

| Journey | Result | Evidence |
|---------|--------|----------|
| **1** | PASS | Sealed Renewal Date (2 sealed); recall Effective → Anchored; query Enter does not open Inspector |
| **2** | PARTIAL | Ingest: scan modes + Secure Upload OK; Extract: empty state (no PDF in vault) |
| **3** | PASS | Results ON; 3 timeline rows; Closing Date Inspector → Journey3 provenance; `/portfolio` → `?results=1` |
| **4** | PARTIAL | Record Settings invite form visible (SUPER_ADMIN); accept/reject/revoke not exercised |
| **5** | PARTIAL | History tab on unsealed pulse → “No revision history”; draft/apply not implemented |
| **6** | PASS | Inbox panel opens; “No unread notifications” |
| **7** | PARTIAL | Profile identity + email; Authorities shell; User Audit Log toggle (empty) |
| **8** | PASS | Key posture “Active”; members list; invite field (brief gate flash before role loads) |
| **9** | — | Signature panel not reachable from rail (shell only) |
| **10** | — | Alerts panel not exercised this run |

---

## Known automation limits

| Item | Workaround |
|------|------------|
| Google OAuth | Email/password test users |
| Vault keys | Pre-unlock in same browser session |
| Gemini extract | Seed pulses via `npm run test:seed` |
| Journey 4 accept | Manual SQL until accept UI ships |
| PDF upload in MCP | Add `docs/fixtures/sample-contract.pdf`; manual upload |
| Second user | Create invitee account in Supabase Auth |
