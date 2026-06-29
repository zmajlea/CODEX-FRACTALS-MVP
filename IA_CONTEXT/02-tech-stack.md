# 02 — Tech Stack

## Runtime versions (as of repo state)

| Layer | Technology | Version / notes |
|-------|------------|-----------------|
| Framework | Next.js (App Router) | 16.2.6 |
| UI | React | 19.2.4 |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS | 3.4.x |
| Auth + DB + Storage | Supabase | `@supabase/ssr` 0.10.3, `@supabase/supabase-js` 2.106.x |
| LLM | Google Gemini | `@google/generative-ai`, model `gemini-2.5-flash` |
| PDF | pdf-parse v2, pdfjs-dist | Client preview + server text extract |
| Office | mammoth (DOCX), xlsx (XLSX) | Ingest pipeline |
| Deploy | Vercel | Production host |
| DB CLI | Supabase CLI | `supabase` 2.102.x (devDependency) |
| Direct PG (fallback) | `pg` | `scripts/apply-migration-pg.mjs` |

## Next.js 16 specifics

- **Session refresh:** `proxy.ts` at repo root (replaces legacy `middleware.ts` naming in Next 16)
- **React Compiler:** `babel-plugin-react-compiler` in devDependencies
- **Server/client split:** `"use client"` on interactive pages; API routes under `app/api/`

## Backend model

There is **no separate Express/FastAPI server**. Backend = **Supabase cloud** + thin **Next.js API routes**:

| Route | Purpose |
|-------|---------|
| `POST /api/gemini-extract` | Gemini document extraction |
| `GET /api/auth/google` | Start Google OAuth (redirect) |
| `GET /auth/callback` | OAuth code exchange (Supabase SSR) |

All vault data reads/writes go **browser → Supabase** with RLS, except Gemini (document text sent to API route).

## Path aliases

`tsconfig.json` maps `@/*` → project root. Always import as:

```ts
import { createClient } from "@/utils/supabase/client";
import type { Database } from "@/lib/database.types";
```

## Windows dev notes

- Prefer `npm run dev:14000` (port 14000 is the documented local URL)
- `npx supabase` from `CODEX-FRACTALS-MVP/`; use `scripts/install-supabase-cli.ps1` if CLI fails
- Direct `db.*.supabase.co` DNS may fail on some networks; use **Session pooler** URI or `supabase db push` (linked)
