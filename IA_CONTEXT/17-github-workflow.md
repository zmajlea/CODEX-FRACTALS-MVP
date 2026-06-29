# 17 — GitHub Workflow

## Repository

- **URL:** https://github.com/zmajlea/CODEX-FRACTALS-MVP
- **Branch:** `main`
- **Root:** `CODEX-FRACTALS-MVP/` (repo root = app root)

## Clone

```powershell
git clone https://github.com/zmajlea/CODEX-FRACTALS-MVP.git
cd CODEX-FRACTALS-MVP
npm install
cp .env.local.example .env.local   # if example exists; else create from IA_CONTEXT/10
npm run dev:14000
```

## Typical commit flow

```powershell
cd c:\CODEX_FACTALS\CODEX-FRACTALS-MVP
git status
git add <files>
git commit -m "Short summary of why"
git push origin main
```

On Windows PowerShell, use `-m` twice for body or a single-line message (heredoc is bash-only).

## What triggers deploy

Push to `main` → Vercel auto-build (if GitHub integration enabled).

After deploy:

1. Confirm build succeeded in Vercel dashboard
2. Smoke test production URL
3. If schema changed, ensure `db:push` was run **before** app code depends on new columns

## Pull requests

Use `gh` CLI from app root:

```powershell
gh pr create --title "..." --body "..."
```

See user rules for full PR checklist (status, diff, test plan).

## Do not commit

- `.env.local`
- `SUPABASE_SERVICE_ROLE_KEY` / API keys in any file
- `.next/` build output
- `node_modules/`

## Commit message style (from history)

Examples from repo:

- `Add multi-format ingest/extract and session sync`
- `Add linear timeline, eventType/qualifier labels, and vault decrypt perf.`

Prefer **why** over **what**; complete sentences.

## Sync with Supabase after merge

When a PR adds migrations:

```powershell
git pull origin main
npx supabase db push --yes
npm run db:types
```

If migration history diverged, see [08-supabase-cli.md](./08-supabase-cli.md) → `migration repair`.

## IA_CONTEXT maintenance

When merging features that change architecture, update the relevant `IA_CONTEXT/*.md` in the same PR so the next agent stays accurate.
