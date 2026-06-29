# 04 — Design System (Digital Vellum)

## Aesthetic name

**Digital Vellum** — warm paper UI, ink typography, minimal chrome.

## Color tokens

Defined in `app/globals.css` and `tailwind.config.js`:

| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| Vellum | `#FCFBF9` | `bg-vellum` | Page background |
| Obsidian (Ink) | `#1A1A1B` | `text-obsidian` | Primary text |
| Oxford | `#2C3E50` | `text-oxford` | Secondary brand |
| **Pulse Amber** | `#EBC06D` | `bg-amber` | Proposed / unsealed pulses |
| **Cinnabar** | `#E67E50` | `bg-cinnabar` | Active / focused state |
| **Sealed Bone** | `#DED9D1` | `bg-bone` | Sealed / anchored pulses |
| Emerald | `#10b981` | `bg-emerald` | Vault **unlocked** posture only (not sealed dots) |

## Timeline node states (v4)

| State | Dot | Focused row |
|-------|-----|-------------|
| Unsealed | Amber + `pulse-amber` | — |
| Focused | — | Cinnabar border/bg |
| Sealed | Bone | Cinnabar or bone border |

Implemented in `components/PortfolioTimeline.tsx` and `components/RecordLedger.tsx`.

## Typography

- **Headings:** `font-head` (Playfair Display)
- **Data / labels:** `font-data` (Inter), `tracking-ultra`, `uppercase` for micro-labels

## UI paradigm (non-negotiable)

1. **No traditional sidebar** — use **CodexRails** (left icon rail) + **Switchboard** for vault selection
2. **No chat UI** — query bar is a **filter**, not an LLM chat
3. **Low-entropy lists** — timeline/ledger show summaries; full evidence in **Inspector** (S6)
4. **Pulse states** — color indicates encryption/seal status (amber / cinnabar / bone)
5. **Gating** — features are Hidden, Disabled+reason, or Error-on-attempt (`lib/gating.ts`)

## Layout shell

`components/DashboardShell.tsx` wraps all `(dashboard)` routes:

- `CodexRails` — top bar + left rail
- `AuthSessionSync` — cookie/session alignment
- Providers: `ActiveVaultProvider`, `FocusProvider`, `OverlayStackProvider`
- `NoiseOverlay` — subtle texture

## Inspector surfaces

| Component | When |
|-----------|------|
| `TriageInspectorOverlay` | Extract review, batch seal |
| `InspectorOverlay` | Record Home single-pulse view/seal |
| `PulseLabelFields` | Shared eventType + qualifier editor |
