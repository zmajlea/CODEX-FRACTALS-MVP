# 01 — Monorepo and Sibling Context

## Workspace layout

```
c:\CODEX_FACTALS\
├── .cursorrules              # Global agent rules (read before any change)
├── CODEX-FRACTALS-MVP\       # ★ Active Next.js app (this repo)
├── CODEX_NDA-main\           # Product/legal context (check before moves)
└── Fractals-UX-UI-main\      # UX specs, Tasks/ folder (check before UI work)
```

## Agent rule (from `.cursorrules`)

> Check **CODEX_NDA-main** and **Fractals-UX-UI-main** for context before any move.

When implementing UI or product behavior, cross-reference:

- **Fractals-UX-UI-main/Tasks/** — surface specs (S1 Gateway, S3 Record Home, S6 Inspector, etc.)
- **CODEX_NDA-main** — naming, compliance, domain language

## Git repository

The MVP is its **own git repo** (not the parent `CODEX_FACTALS` folder):

- **Remote:** `https://github.com/zmajlea/CODEX-FRACTALS-MVP.git`
- **Default branch:** `main`
- **Working directory for all git/supabase/npm commands:** `CODEX-FRACTALS-MVP/`

```powershell
cd c:\CODEX_FACTALS\CODEX-FRACTALS-MVP
```

Never run `supabase link` or `npm run db:push` from the parent folder unless that folder is separately configured.

## IA_CONTEXT purpose

This `IA_CONTEXT/` folder lives **inside** the MVP repo so it versions with the code. New agents should read `IA_CONTEXT/README.md` first instead of scanning the entire monorepo blindly.
