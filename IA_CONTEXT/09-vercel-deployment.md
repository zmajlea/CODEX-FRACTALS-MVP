# 09 — Vercel Deployment

## Production app

- **URL:** https://codex-fractals-mvp.vercel.app
- **Repo:** https://github.com/zmajlea/CODEX-FRACTALS-MVP
- **Branch:** `main` (auto-deploy on push, if connected)

## Vercel CLI (optional)

### Install & login

```powershell
npm i -g vercel
vercel login
```

### Link project (first time)

```powershell
cd c:\CODEX_FACTALS\CODEX-FRACTALS-MVP
vercel link
```

### Deploy

```powershell
vercel              # preview
vercel --prod       # production
```

Most teams rely on **GitHub integration** instead of manual CLI deploys.

## Required environment variables (Vercel Dashboard)

Set in **Project → Settings → Environment Variables** for **Production** (and Preview if needed):

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | `https://tswdwmtrirdhtwqmsasz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon/publishable key |
| `GOOGLE_GENAI_API_KEY` | Yes | For `/api/gemini-extract` |
| `SUPABASE_SERVICE_ROLE_KEY` | If server admin | Never expose to client |
| `NEXT_PUBLIC_SITE_URL` | Optional | Set to `https://codex-fractals-mvp.vercel.app` or **remove** |

### Critical: do NOT set in Production

```
NEXT_PUBLIC_SITE_URL=http://localhost:14000
```

`lib/site-url.ts` prefers request origin, but a wrong env can break OAuth redirects.

## After env changes

**Redeploy** — Vercel does not hot-reload env vars into running deployments.

## Google OAuth on production

1. Google Cloud OAuth client redirect URI:
   `https://tswdwmtrirdhtwqmsasz.supabase.co/auth/v1/callback`
2. Supabase Google provider enabled with Client ID/Secret
3. `npm run auth:config:push` — site_url = production Vercel URL
4. App uses `/api/auth/google` on the **same host** the user opened

## Build command

Default Next.js:

```
npm run build
```

Verified locally; uses Next.js 16 + Turbopack build.

## Local vs production

| | Local | Production |
|---|-------|------------|
| App host | `localhost:14000` | `codex-fractals-mvp.vercel.app` |
| Supabase | Same project `tswdwmtrirdhtwqmsasz` | Same |
| Auth redirects | In `config.toml` additional_redirect_urls | `site_url` = Vercel |

Same Supabase project means **same users and vaults** on local and Vercel (when using same credentials).
