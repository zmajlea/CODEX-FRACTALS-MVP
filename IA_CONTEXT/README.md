# IA_CONTEXT — Agent Onboarding Pack

This folder is the **single entry point** for a new AI agent (or human developer) to understand, extend, or recreate the **CodexOne / Fractals MVP** application.

Read files in order for a full picture, or jump to the section you need.

## Quick start (5 minutes)

1. [00-project-overview.md](./00-project-overview.md) — What this app is
2. [10-environment-variables.md](./10-environment-variables.md) — `.env.local` setup
3. [11-npm-scripts-and-tooling.md](./11-npm-scripts-and-tooling.md) — `npm run dev:14000`
4. [08-supabase-cli.md](./08-supabase-cli.md) — Link project + `db:push`
5. [09-vercel-deployment.md](./09-vercel-deployment.md) — Production deploy

## Full index

| # | File | Purpose |
|---|------|---------|
| 00 | [project-overview](./00-project-overview.md) | Product, users, MVP scope |
| 01 | [monorepo-and-siblings](./01-monorepo-and-siblings.md) | Parent repo, related folders |
| 02 | [tech-stack](./02-tech-stack.md) | Versions, libraries, runtime |
| 03 | [repo-structure](./03-repo-structure.md) | Folders, naming, imports |
| 04 | [design-system](./04-design-system.md) | Colors, typography, UI paradigm |
| 05 | [architecture-and-patterns](./05-architecture-and-patterns.md) | Next.js App Router, contexts, auth |
| 06 | [security-e2e-encryption](./06-security-e2e-encryption.md) | Vault keys, ciphertext invariant |
| 07 | [database-schema](./07-database-schema.md) | Tables, RLS, migrations |
| 08 | [supabase-cli](./08-supabase-cli.md) | Link, push, repair, types, auth |
| 09 | [vercel-deployment](./09-vercel-deployment.md) | Vercel CLI, env vars, URLs |
| 10 | [environment-variables](./10-environment-variables.md) | All env keys (no secrets) |
| 11 | [npm-scripts-and-tooling](./11-npm-scripts-and-tooling.md) | package.json scripts |
| 12 | [routes-and-surfaces](./12-routes-and-surfaces.md) | App routes + Release 1 surfaces |
| 13 | [key-modules](./13-key-modules.md) | lib/, components/, API routes |
| 14 | [data-flows](./14-data-flows.md) | Ingest → extract → seal → query |
| 15 | [agent-rules](./15-agent-rules.md) | Non-negotiables for AI agents |
| 16 | [testing-and-seeding](./16-testing-and-seeding.md) | Journey tests, seed scripts |
| 17 | [github-workflow](./17-github-workflow.md) | Commit, push, PR conventions |
| FF | **[FF-V1-MASTER-PROMPT](./FF-V1-MASTER-PROMPT.md)** | **Copy-paste Composer prompt for Financial Firefighter V1** |

## Live URLs

| Environment | URL |
|-------------|-----|
| Production | https://codex-fractals-mvp.vercel.app |
| Local dev | http://localhost:14000 |
| Supabase dashboard | https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz |
| GitHub | https://github.com/zmajlea/CODEX-FRACTALS-MVP |

## Supabase project

- **Project ref:** `tswdwmtrirdhtwqmsasz`
- **API URL:** `https://tswdwmtrirdhtwqmsasz.supabase.co`

## When to update this pack

Update relevant `IA_CONTEXT/*.md` files when you:

- Add a migration under `supabase/migrations/`
- Change env var names or deployment steps
- Add a major route or surface
- Change encryption or auth patterns

Do **not** commit secrets into this folder.
