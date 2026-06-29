# 00 — Project Overview

## Product

**Fractals MVP** (CodexOne Fractal 1) is a B2B tool for **Fractional CFOs** and similar professionals who need to:

1. **Ingest** commercial/legal documents (PDF, CSV, XLSX, DOCX, etc.)
2. **Extract** obligations, dates, and entities via Gemini (server-side API)
3. **Triage** AI suggestions in an Inspector (human review)
4. **Seal** accepted facts into an encrypted ledger (`temporal_objects`)
5. **Query** sealed records on a **linear timeline** (local filter, not LLM)

The mental model is **truthmaking**: proposed (amber) → focused (cinnabar) → sealed/anchored (bone).

## App root

All active code lives in:

```
c:\CODEX_FACTALS\CODEX-FRACTALS-MVP\
```

The parent folder `c:\CODEX_FACTALS\` may contain sibling repos for UX specs and NDA context — see [01-monorepo-and-siblings.md](./01-monorepo-and-siblings.md).

## What is NOT in this MVP

- No traditional sidebar navigation (use **Switchboard** + **CodexRails**)
- No chat/conversational UI
- No server-side decryption of vault content (E2E only)
- No radial Nautilus timeline on Record Home (replaced by linear timeline in v4)
- Firebase is listed in `package.json` but **not used** in the MVP path

## Core user journeys

| Journey | Flow |
|---------|------|
| Auth | `/login` → Supabase email or Google OAuth → `/switchboard` |
| Unlock vault | Switchboard card → encryption key modal → session key in `sessionStorage` |
| Ingest | `/vault/[id]/ingest` → multi-format upload → Supabase Storage (ciphertext) |
| Extract | `/vault/[id]/extract` → Gemini → Triage Inspector → batch seal |
| Record Home | `/vault/[id]` → linear timeline + ledger + sealed-only filter |
| Results Mode | Switchboard drawer → portfolio timeline across vaults |

Detailed test credentials and steps: `docs/test-scenarios.md`, `docs/test-scenarios-release1.md`.

## Pulse label system (v4)

Each sealed **pulse** uses a two-part label:

- **eventType** — controlled vocabulary (`Signing`, `Payment Due`, etc.)
- **qualifier** — short clause fragment (e.g. `$2M Tranche A`)
- **composedLabel** — `{eventType} - {qualifier}` (max 60 chars), stored encrypted in `title_ciphertext`

See `lib/temporal/event-types.ts`.
