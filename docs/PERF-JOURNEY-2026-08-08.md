# PERF-JOURNEY-2026-08-08

Measured against live production as a real operator session (Playwright headless Chromium).  
**No app code changes. No redeploy.** Gate client reset to empty at end.

| | |
|---|---|
| **Target** | `https://codex-fractals-mvp.vercel.app` |
| **Operator** | `ana_gate_operator@codexone.test` |
| **Client** | `ana_gate_client_4@codexone.test` (`6d53f194-e71b-4965-aecc-eab9f81ed311`) |
| **When** | 2026-08-08 (off-hours EU morning) |
| **Trials** | Median of 3 unless noted |
| **CSV** | `docs/summit-ffm-0625.csv` (~1086 rows; HCCLAIMPMT = 546) |

---

## Step 0 — region / RTT / cold-warm

### Regions (biggest cheap win)

| Layer | Evidence | Region |
|---|---|---|
| Vercel **edge** | `x-vercel-id: cdg1::iad1::…` | **cdg1** (Paris) |
| Vercel **serverless function** | same header, second token | **iad1** (US East / Ashburn) |
| Supabase project | `tswdwmtrirdhtwqmsasz.supabase.co` | Not exposed by health API; **dashboard confirmation needed**. Latency profile is consistent with **US-hosted DB** (every cheap `GET …/accounts` is already ~1.6–2.1s). |

**Co-location verdict:** Functions run in **iad1** while the browser hit a **cdg1** edge. Operator journeys from EU therefore pay **EU→US** on every serverless invocation, then the function talks to Supabase. If Supabase is also US-East, function↔DB is co-located but **user↔function is cross-Atlantic**. Moving Vercel functions to an EU region (or confirming/moving Supabase to match) is a config-level win that multiplies across every sequential round-trip — no app code required.

### RTT baseline

Light authenticated call: `GET /api/operator/treasury/clients/{id}/accounts` (5× after login + key-unlock assert).

| Trial | ms |
|---|---:|
| 1 | 2002 |
| 2 | 1796 |
| 3 | 1691 |
| 4 | 1817 |
| 5 | 2013 |
| **Median** | **1817ms** |

Interpretation: a step that fires **N sequential** treasury API calls has a **floor ≈ N × 1.8s** before server work. Many “slow tabs” below are primarily **round-trip-bound**, not heavy queries.

### Cold vs warm

| | Wall | Treasury reqs | Notes |
|---|---:|---:|---|
| Cold overview nav (first hit) | 3449ms | 7 | Includes drafts/rules/accounts fan-out |
| Warm accounts RTT | ~1.6–2.1s | 1 | Steady after warm-up |

No `Server-Timing` headers observed — server vs network attribution is **inferred** from RTT.

### Key unlock

Topbar **Key unlocked** asserted before any timed step. (Treasury shells currently hardcode `keyUnlocked`; assert still ran.)

---

## Book sizes (verified)

| Book | How built | `count(*)` |
|---|---|---:|
| **Small** | 1× `summit-ffm-0625.csv` | **1086** |
| **Large** | Small + 6 Account-rewritten clones (`0625-b`…`0625-g`) so `external_id` hashes differ | **7602** |

Count verified after **every** clone import (1086 → 2172 → 3258 → 4344 → 5430 → 6516 → 7602). Same CSV re-imported without Account rewrite would have deduped to ~1086.

---

## Step table (median wall / #reqs / slowest)

Wall times are UI-ready unless noted. “Likely cause” uses Step-0 RTT ≈ **1.8s**.

| Step | Small median | #reqs | Slowest (small) | Large median | #reqs | Slowest (large) | Likely cause |
|---|---:|---:|---|---:|---:|---|---|
| Reset (POST wipe) | 13.4s | 7 | `POST …/reset` 3.0s | 22.1s | 7 | `POST …/reset` 12.0s | Mix: wipe work grows with book + several follow-up GETs × RTT |
| CSV import | 8.6s | 6 | `POST …/import-csv` 5.6s | ~15.1s/clone | 6 | import-csv dominates | Server-bound import + reload fan-out; large clones slower as book grows |
| Overview | 5.6s | 6–7 | `…/accounts` ~1.9s | **12.8s** | 6–10 | `…/rules` ~5.0s | **RTT-bound fan-out** (6–10 calls); large overview worse |
| Forecast | 5.8s | 10 | `…/forecast` ~1.9s | 6.9s | 10 | `…/summary` ~2.8s | ~10 sequential calls × RTT; mild server growth on summary |
| Transactions open | 6.8s | 8 | `…/accounts` ~2.0s | 5.7s | 8 | `…/accounts` ~1.8s | RTT-bound fan-out (does not scale badly with book size) |
| Tx page Next | ~1.2s | 0–1 | — | ~1.2s | 0–1 | — | Often cached / single page fetch; first Next after full reload paid shell cost |
| Filter All | 7.6s | 9 | `…/transactions` ~3.3s | 6.1s | 9 | `…/accounts` ~2.0s | Full tab remount in harness (9 calls × RTT) — not a pure in-place filter cost |
| Filter Uncategorized | 7.3s | 9 | accounts ~4.2s | 5.0s | 9 | accounts ~2.2s | Same as above |
| Filter Suggested | 7.3s | 9 | accounts ~3.8s | 4.8s | 9 | accounts ~1.9s | Same as above |
| Filter Confirmed | 4.6s | 9 | accounts ~1.7s | 5.2s | 9 | transactions ~2.3s | Same as above |
| Rule popup open | 0.55s | 0 | — | 0.54s | 0 | — | Client-only portal; no API |
| Rule save (Create) | 7.0s | 11 | `POST …/rules` 3.5s | 4.9s | 10 | `GET …/rules` 5.1s | Apply-on-create + facets/reload; POST rules includes suggestion apply |
| Queue “All suggested” | 0.8s | 0–3 | — | 0.9s | 0–2 | — | Facet already warm after expand |
| **Confirm all suggested** | **127.4s** | 1 | **`PATCH …/bulk-label` 127.2s** | *(not re-run at 7.6k; see note)* | — | — | **Server-bound per-row confirm path** — see below |
| Confirm bucket (contrast) | — | — | — | — | — | — | No combo-bucket Confirm control visible in this fixture |
| Analyzer | 6.3s | 10 | limit=1 ~2.4s | 7.8s | 10 | summary ~3.8s | Fan-out × RTT + summary cost up slightly with book |
| Recommendations tab | 5.6s | 5 | accounts ~1.9s | 5.6s | 5 | limit=1 ~1.9s | Tab open only (not full Seal & send) |

### Confirm all — corrected measurement (critical)

First journey pass **under-reported** Confirm all (~11s) because:

1. Native `window.confirm(...)` was not accepted by Playwright → click did nothing.
2. Ready-wait fell through a **10s “Confirming…” timeout + 1s** ≈ 11s fake wall.
3. Method is **`PATCH …/transactions/bulk-label`**, not POST.

**Remeasured** with `page.on('dialog', d => d.accept())`, 546 suggestions, 3 trials (unlabel + Re-apply between trials):

| Trial | Wall | `PATCH …/bulk-label` | Suggestions before → after |
|---:|---:|---:|---|
| 1 | 127407ms | 127211ms | 546 → 0 |
| 2 | 128262ms | 128023ms | 546 → 0 |
| 3 | 127033ms | 126816ms | 546 → 0 |
| **Median** | **127407ms (~127s)** | **~127s** | |

**Cause:** one long **`PATCH /transactions/bulk-label`** with `{ confirmAllSuggested: true, ruleId }` — server-side per-row loop. At ~127s / 546 ≈ **233ms per suggestion** on this path. Extrapolating linearly, ~4000 suggestions ≈ **~15+ minutes** unless Spec 67 batches/RPC-ifies it. This is **server-bound**, not RTT-bound (single request).

Large-book Confirm all was **not** re-run after the dialog fix (would require unlabeled HCCLAIMPMT across 7 accounts ≈ 3800 suggestions and a very long gate window). Treat small-book **127s / 546** as the authoritative confirm cost model.

---

## Ranked worst offenders

1. **Confirm all suggested** — **~127s** — single `PATCH …/bulk-label` (per-row server loop)  
2. **Reset @ 7.6k** — ~22s — wipe + reload fan-out  
3. **CSV clone import @ large** — ~15–20s each — `import-csv` + reloads; grows with book  
4. **Overview @ 7.6k** — ~12.8s — many sequential GETs × ~1.8s RTT (`rules` spike ~5s)  
5. **Filter remounts** — ~5–8s — harness remounted the tab (9 calls × RTT); in-app in-place filter likely cheaper but still multi-fetch  
6. **Rule create/save** — ~5–7s — `POST …/rules` applies suggestions + facets reload  
7. **Forecast / Analyzer** — ~6–8s — ~10 parallel-looking but still chatty loads × RTT  

**Dominant systemic theme:** with **~1.8s RTT**, any screen that fires 6–10 sequential authenticated treasury calls feels “multi-second” even when each query is light. Fixing region co-location and/or batching fan-out would move the floor; Spec 67 must still attack **bulk-label** separately.

---

## Scaling curve (small 1086 → large 7602)

| Step | Scales with book? | Note |
|---|---|---|
| Overview | **Yes** (5.6s → 12.8s) | Extra work on rules/list paths |
| Forecast | Mild (5.8s → 6.9s) | |
| Transactions open / filters | **No / flat** | Still RTT-dominated |
| Import | **Yes** per clone | 8.6s → 12–20s |
| Confirm all | **Yes (linear in suggestions)** | ~233ms/suggestion measured |

---

## Safety / cleanup

- Only `ana_gate_client_4` touched.  
- Final reset: **tx count = 0**.  
- Tim / real clients not opened.

---

## Method caveats

- Filter steps used full `?tab=transactions` remounts before each click → inflated vs in-place segment clicks.  
- Recommendations = tab open only (no Seal & send / Send question E2E).  
- Rule stats/preview wall in the auto table is under-counted (debounce overlapped measurement windows); payee-stats/preview **did** appear during create (~1.0–1.6s each).  
- Playwright tooling left under `scripts/perf/` (ephemeral; do not treat as product). Raw JSON: `scripts/perf/out/raw.json`, confirm: `scripts/perf/out/confirm-remeasure.json`.

---

## Raw appendix (Step 0 + confirm)

```json
{
  "vercelId": "cdg1::iad1::…",
  "rttMedianMs": 1817,
  "rttTrialsMs": [2002, 1796, 1691, 1817, 2013],
  "coldOverviewMs": 3449,
  "smallTxCount": 1086,
  "largeTxCount": 7602,
  "confirmAllSuggested": {
    "medianWallMs": 127407,
    "trialsWallMs": [127033, 127407, 128262],
    "bulkLabelMedianMs": 127211,
    "suggestions": 546,
    "endpoint": "PATCH /api/operator/treasury/clients/{id}/transactions/bulk-label"
  }
}
```
