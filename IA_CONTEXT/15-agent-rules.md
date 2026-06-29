# 15 — Agent Rules

Consolidated from `c:\CODEX_FACTALS\.cursorrules` and project invariants.

## Before any change

1. Read `IA_CONTEXT/README.md` (this pack)
2. Check **CODEX_NDA-main** and **Fractals-UX-UI-main/Tasks/** for product/UX context
3. Work inside **`CODEX-FRACTALS-MVP/`** only unless explicitly scoped otherwise

## Stack constraints

- **Next.js App Router** — no Pages router for new code
- **Supabase** for auth, Postgres, storage — not Firebase for MVP features
- **Tailwind** — use design tokens (`vellum`, `amber`, `bone`, `cinnabar`, `obsidian`)
- **TypeScript** — maintain strict typing; regenerate DB types after migrations

## Security (non-negotiable)

- Encrypt sensitive fields **client-side** before Supabase (`lib/encryption-core.ts`)
- Never log or persist vault passwords server-side
- Never put `SUPABASE_SERVICE_ROLE_KEY` in client code
- Server sees **ciphertext only** for document content

## UI constraints

- **No traditional sidebar** — CodexRails + Switchboard
- **No chat UI** — QueryInterface is a filter
- **Linear timeline** on Record Home — not radial Nautilus for new work
- **Inspector** is the only place for full evidence text
- **Pulse colors:** Amber = proposed, Cinnabar = focused, Bone = sealed

## Gating

Use `lib/gating.ts` patterns: Hidden | Disabled+reason | Error-on-attempt.

## Code style

- Minimal scope — don't refactor unrelated files
- Match existing naming and file layout
- Reuse `lib/` helpers; don't duplicate encrypt/decrypt
- Comments only for non-obvious business logic

## Migrations

1. Add SQL file under `supabase/migrations/`
2. `npx supabase db push --yes`
3. `npm run db:types`
4. Update fetch/seal/read paths
5. Update `IA_CONTEXT/07-database-schema.md` if schema changed materially

## Git

- Do not commit `.env.local` or secrets
- Do not commit to `IA_CONTEXT` with real passwords/tokens
- User must explicitly ask for commits (see user rules)

## Common pitfalls

| Mistake | Correct approach |
|---------|------------------|
| LLM in query bar | Local `filterSealedPulses` only |
| Plaintext title in DB | `title_ciphertext` + `event_type` |
| `middleware.ts` only | Use `proxy.ts` (Next 16) |
| dev on port 3000 in docs | Document `dev:14000` |
| Run supabase from parent folder | Always `CODEX-FRACTALS-MVP/` |

## Event type labels

- `eventType` must be from `EVENT_TYPES` in `lib/temporal/event-types.ts`
- `qualifier` max composed label 60 chars with `eventType - qualifier`
- Validate before seal: `validateComposedLabel()`
