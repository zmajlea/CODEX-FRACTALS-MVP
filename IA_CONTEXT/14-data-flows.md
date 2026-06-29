# 14 — Data Flows

## 1. Ingestion

```mermaid
sequenceDiagram
  participant U as User
  participant UI as VaultFileUpload
  participant E as encryption-core
  participant S as Supabase Storage
  participant DB as Postgres files

  U->>UI: Select files
  UI->>E: Encrypt file bytes
  UI->>S: Upload ciphertext
  UI->>DB: Insert files row (name ciphertext)
```

- Route: `/vault/[id]/ingest`
- Formats: `lib/files/supported-formats.ts`

## 2. Extraction

```mermaid
sequenceDiagram
  participant U as User
  participant P as extract/page
  participant API as /api/gemini-extract
  participant G as Gemini
  participant T as TriageInspector

  U->>P: Run extraction
  P->>P: Decrypt file text client-side
  P->>API: POST text + lensId
  API->>G: JSON schema prompt
  G-->>API: eventType, qualifier, body...
  API-->>P: ExtractSuggestion[]
  P->>T: TriageSuggestion[] (editable)
```

- Model: `gemini-2.5-flash`
- Output: `eventType` + `qualifier` (not document title)

## 3. Seal (batch)

```mermaid
sequenceDiagram
  participant T as TriageInspector
  participant E as encryption-core
  participant DB as temporal_objects

  T->>T: validateComposedLabel each row
  T->>E: Encrypt title, qualifier, body, explanation
  T->>DB: INSERT verified_at=now, event_type plaintext
```

- `lib/temporal/seal-batch.ts`

## 4. Seal (single pulse)

- Record Home → Inspector → `sealPulse()` → UPDATE row with `verified_at`

## 5. Record Home load

```mermaid
flowchart LR
  A[fetchVaultTemporalObjectsProgressive] --> B[Decrypt titles batch 50]
  B --> C[PortfolioTimeline + RecordLedger]
  C --> D[User opens Inspector]
  D --> E[hydrateTemporalObjectDetails body]
```

- Large vaults: first paint after ~50 rows

## 6. Query (filter)

- **Not LLM** — `filterSealedPulses(objects, query)` in memory
- Empty query → all objects
- Active query → **sealed only**, token match on eventType, qualifier, date, label

## 7. Portfolio / Results Mode

- `fetchPortfolioDateObjects` → `ResultsModeDrawer` → `PortfolioTimeline`
- Cross-vault; RLS limits to member vaults

## Pulse object shape (client)

`PortfolioTemporalObject` in `lib/temporal/portfolio-fetch.ts`:

- `eventType`, `qualifier`, `composedLabel`
- `parsedDate`, `category`, `isSealed`, `isLocked`
- `body`, `explanation` (lazy)
