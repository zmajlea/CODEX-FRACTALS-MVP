# 12 — Routes and Surfaces

## Public routes

| Path | File | Purpose |
|------|------|---------|
| `/` | `app/page.tsx` | Redirect if authed |
| `/login` | `app/login/` | Email + Google sign-in |
| `/signup` | `app/signup/` | Registration |
| `/auth/callback` | `app/auth/callback/route.ts` | OAuth exchange |

## Dashboard routes (`app/(dashboard)/`)

Wrapped by `DashboardShell` + `CodexRails`.

| Path | Surface | Spec ID |
|------|---------|---------|
| `/switchboard` | Gateway, vault cards, Results Mode | S1 |
| `/vault/[vaultId]` | Record Home — linear timeline + ledger | S3 |
| `/vault/[vaultId]/ingest` | Multi-format upload | S3A |
| `/vault/[vaultId]/extract` | Gemini + Triage Inspector | Extraction Engine |
| `/vault/[vaultId]/settings` | Record settings | S10 |
| `/profile` | Profile settings | S11 |
| `/portfolio` | Redirect → `/switchboard?results=1` | S1 drawer |

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/gemini-extract` | LLM extraction |
| GET | `/api/auth/google` | OAuth redirect |

## Release 1 surface map

| ID | Name | Primary component(s) |
|----|------|----------------------|
| S1 | Gateway + Results | `switchboard/page.tsx`, `ResultsModeDrawer`, `PortfolioTimeline` |
| S3 | Record Home | `vault/[vaultId]/page.tsx`, `PortfolioTimeline`, `RecordLedger` |
| S3A | Ingestion | `ingest/page.tsx`, `VaultFileUpload` |
| S6 | Inspector | `InspectorOverlay`, `TriageInspectorOverlay` |
| S7 | Seal | `seal-pulse.ts`, `seal-batch.ts`, `HankoSeal` |
| S10 | Record Settings | `vault/.../settings/page.tsx` |
| S11 | Profile | `profile/page.tsx` |

## Auth proxy matcher

`proxy.ts` runs on all routes except static assets (`_next/static`, images, favicon).

Protected prefixes: `/switchboard`, `/vault`, `/portfolio`, `/profile`.

## Navigation paradigm

- **Switchboard** — pick/unlock vault (no left sidebar list of pages)
- **CodexRails** — icon rail: Records, Modules, Audit, Ingestion, Inbox
- **No URL for "chat"** — bottom bar is filter-only `QueryInterface`
