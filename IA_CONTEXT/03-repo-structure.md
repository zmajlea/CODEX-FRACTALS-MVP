# 03 — Repository Structure

```
CODEX-FRACTALS-MVP/
├── IA_CONTEXT/                 # Agent onboarding docs (this folder)
├── app/
│   ├── (dashboard)/            # Authenticated shell (DashboardShell)
│   │   ├── layout.tsx
│   │   ├── switchboard/
│   │   ├── profile/
│   │   └── vault/[vaultId]/
│   │       ├── page.tsx        # Record Home (linear timeline)
│   │       ├── ingest/
│   │       ├── extract/
│   │       └── settings/
│   ├── api/
│   │   ├── gemini-extract/route.ts
│   │   └── auth/google/route.ts
│   ├── auth/callback/route.ts
│   ├── login/ signup/
│   ├── portfolio/              # Redirect to switchboard?results=1
│   ├── layout.tsx globals.css
│   └── page.tsx
├── components/                 # UI (CodexRails, Inspector, Timeline, etc.)
├── lib/
│   ├── temporal/               # Pulses, fetch, seal, query, event-types
│   ├── files/                  # Upload, download, formats
│   ├── context/                # active-vault, focus, overlay-stack
│   ├── encryption-core.ts      # Web Crypto PBKDF2 + AES-GCM
│   ├── encryption.ts           # Re-exports + clearDerivedKeyCache
│   ├── database.types.ts       # Generated Supabase types
│   └── intelligence-lenses.ts  # Gemini lens prompts
├── utils/supabase/
│   ├── client.ts               # Browser Supabase
│   ├── server.ts               # Server Components / routes
│   └── middleware.ts           # updateSession (used by proxy.ts)
├── supabase/
│   ├── config.toml             # Auth URLs, project_id
│   └── migrations/*.sql        # Ordered schema history
├── scripts/                    # Seeds, verify, benchmark, migration helpers
├── docs/                       # Test scenarios, APPLY_MIGRATION
├── proxy.ts                    # Next.js 16 auth proxy
├── tailwind.config.js
├── package.json
└── .env.local                  # Local secrets (gitignored)
```

## Conventions

| Pattern | Rule |
|---------|------|
| Client-only crypto | `"use client"` + `lib/encryption-core.ts` |
| Vault key storage | `sessionStorage` key `codexone_key_{vaultId}` via `lib/vault-session.ts` |
| DB types | Regenerate after migration: `npm run db:types` |
| New migration | `supabase/migrations/YYYYMMDDHHMMSS_description.sql` |
| Components | PascalCase files in `components/` |
| Business logic | Prefer `lib/` over inline in pages |

## Do not edit casually

- `lib/database.types.ts` — regenerate from Supabase, don't hand-edit long-term
- `.env.local` — never commit
- `supabase/.temp/` — CLI cache
