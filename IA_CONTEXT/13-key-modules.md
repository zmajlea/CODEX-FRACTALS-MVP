# 13 — Key Modules

## Encryption

| File | Role |
|------|------|
| `lib/encryption-core.ts` | PBKDF2 + AES-GCM, caches |
| `lib/encryption.ts` | Public API, `clearDerivedKeyCache` |
| `lib/vault-session.ts` | sessionStorage vault keys |

## Temporal / pulses

| File | Role |
|------|------|
| `lib/temporal/event-types.ts` | EVENT_TYPES vocab, composeLabel, validation |
| `lib/temporal/record-fetch.ts` | Vault-scoped fetch, progressive decrypt |
| `lib/temporal/portfolio-fetch.ts` | Cross-vault portfolio fetch |
| `lib/temporal/seal-batch.ts` | Batch seal from triage |
| `lib/temporal/seal-pulse.ts` | Single pulse seal from Record Home |
| `lib/temporal/record-query.ts` | `filterSealedPulses` (local only) |
| `lib/temporal/parse-date.ts` | ISO date inference, category→kind |
| `lib/intelligence-lenses.ts` | Gemini lens prompts |

## Files / ingest

| File | Role |
|------|------|
| `lib/files/supported-formats.ts` | Allowed extensions |
| `lib/file-text-extraction.ts` | PDF, CSV, XLSX, DOCX, etc. |
| `lib/files/upload-encrypted-file.ts` | Encrypt + Storage upload |
| `lib/files/download-decrypted-file.ts` | Storage download + decrypt |

## Supabase

| File | Role |
|------|------|
| `utils/supabase/client.ts` | Browser client |
| `utils/supabase/server.ts` | Server client |
| `utils/supabase/middleware.ts` | Session refresh |
| `lib/database.types.ts` | Generated types |
| `lib/supabase/admin.ts` | Service role client |

## UI components (critical)

| Component | Role |
|-----------|------|
| `DashboardShell` | App chrome, providers, sign-out |
| `CodexRails` | Header + left rail |
| `Switchboard` | Vault cards |
| `EncryptionKeyModal` | Unlock vault |
| `PortfolioTimeline` | Linear timeline |
| `RecordLedger` | Virtualized side list |
| `QueryInterface` | Sealed-only filter bar |
| `InspectorOverlay` | Single pulse inspector |
| `TriageInspectorOverlay` | Extract batch review |
| `PulseLabelFields` | eventType + qualifier editor |
| `VaultFileUpload` | Multi-file ingest |
| `AuthSessionSync` | Auth cookie sync |

## API

| File | Role |
|------|------|
| `app/api/gemini-extract/route.ts` | Extraction prompt + parsing |
| `app/api/auth/google/route.ts` | OAuth start |

## Context

| File | Role |
|------|------|
| `lib/context/active-vault.tsx` | Current vault + unlock state |
| `lib/context/focus.tsx` | Keyboard focus between pulses |
| `lib/context/overlay-stack.tsx` | Overlay z-index / stack |

## Deprecated / legacy (still in repo)

| File | Notes |
|------|-------|
| `components/NautilusGrid.tsx` | Radial UI — not used on Record Home v4 |
| `lib/temporal/nautilus-map.ts` | Radial pulse layout |

Do not extend radial UI for new features; use `PortfolioTimeline`.
