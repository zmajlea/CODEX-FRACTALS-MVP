# Changelog

All notable changes to **CODEX-FRACTALS-MVP** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

#### Operator treasury workspace
- Operator client record with accounts, transactions, summary, forecast, rules, CSV import, and labels.
- Portfolio dashboard and operator inbox (`/operator/treasury`, `/operator/treasury/inbox`).
- Operator APIs under `/api/operator/treasury/clients/[clientId]/` for accounts, transactions (bulk label, per-row edit), summary, forecast, rules, recommendations, labels, and CSV import.
- Shared treasury server layer: ingest, rules engine, forecast, recommendations, disconnect, audit, and summary response helpers.
- Supabase migrations for treasury transactions, rules, source dedup, and recommendations.

#### Client treasury (Summit R1-D)
- Recomposed `/client/treasury` Overview: cash-position hero, treasurer strip, cash-flow chart, embedded accounts, and recent activity.
- `TreasuryClientCashHero`, `TreasuryClientTreasurerStrip`, and `TreasuryClientCashTrend` components.
- Client recommendations tab with accept/decline, execution ladder, and seal-on-send.
- Client Connections tab with Plaid link, manual accounts, and source management.
- Self-scoped `GET /api/treasury/summary` (auth via `user.id` only; no client id from request).
- Client APIs for recommendations, manual accounts, and source disconnect.
- Transaction `direction` on client accounts payload for honest in/out coloring in activity.

#### R1 Summit CSV import (Spec 24)
- Summit FFM import contract: 8 columns, signed amounts, ISO datetimes with UTC date extraction, header normalization + headerless fallback.
- Import reconcile report in API and operator UI (inflows/outflows/net, skips, duplicates, sign/type mismatches).
- `account_label` form field for tab-encoded / empty account columns.
- Test fixtures: `docs/summit-ffm-0625.csv`, `docs/summit-ffm-0617.csv`; verification via `npm run treasury:verify-import`.
- `docs/r1-import-contract.md` with ready-to-paste Claude normalization prompt.

#### R1 Summit spend plan (Spec 25)
- Tim's account/label-scoped spend-plan model: allocation ladder, seasonality, four growth scenarios (A/B/C/D), cumulative buffer projection, and historical backtest.
- Pure engine in `lib/treasury/spend-plan.ts` with server orchestration in `lib/server/treasury-spend-plan.ts` (separate from whole-book `treasury-forecast.ts`).
- `GET /api/operator/treasury/clients/[clientId]/spend-plan` with grant check and `spend_plan` audit surface.
- Operator **Spend plan** tab: `TreasurySpendPlanPanel` with method note, provenance chips, seasonal indices, 4-scenario projection, scenario results, and backtest table.
- Partial-month exclusion for L0, seasonality, and TTM YoY (`excludedPartialMonth` in response).
- Verification via `npm run treasury:verify-spend-plan` (Tim backtest + projection fixtures).

- Dev-only `POST /api/dev/seed-journey1` for Journey 1 test data (`SEED_SECRET` in `.env.example`).
- Treasury CSV format docs, templates, and demo datasets under `docs/` and `public/docs/`.
- `scripts/generate-treasury-csv.ts` and Plaid sandbox custom user fixture.

### Changed
- Summit client shell: `data-brand="summit"`, Arimo typography via continuity classes (dropped dead Tailwind utilities on treasury surface).
- Single masthead on client treasury; `TreasuryAccountsView` supports `embedded` mode.
- `continuity.css`: `--mute-ink`, client-treasury tab styles (`.seg`), cash hero / treasurer strip helpers, micro-label legibility fixes.
- Plaid exchange and sync hardening; operator treasury audit events extended.
- CSV importer accepts Tim's Summit export shape; legacy MVP unsigned format still supported.
- Summary, period decomposition, and forecast aggregators exclude `direction === null` (never assume outflow).
- BCN rail brand foot and topbar continuity tweaks; client shell frame adjustments.

### Fixed
- Client recommendations status badges (declined no longer styled as accepted).
- Recommendation impact uses `impact_unit` instead of hardcoded USD.
- Dead CSS classes removed from `components/treasury/**` (`text-codex-muted`, `font-head`, `text-ink`, `bg-ink`, `border-sealed-bone`, `bg-digital-vellum`).
- Unread recommendations badge uses `--su-warn` instead of Fractals cinnabar on Summit.

### Security
- Client summary route: `getUser()` → 401, `canAccessModule(..., "treasury")` → 403, `querySummary(admin, user.id, ...)`.
- Dev seed route returns 404 in production; requires `x-seed-secret` header.

---

## [Prior releases]

See git history before 2026-07-14 for Fractals Platform Steps 1–4 (modules, shells, FF wizard, billing) and earlier vault / BCN work.
