# Treasury CSV import format

> **R1 canonical format:** Tim's Summit FFM structure (8 columns, signed amounts) is documented in [`r1-import-contract.md`](./r1-import-contract.md). The format below remains supported as the **legacy MVP** import path.

Operator CSV import uses the same column layout as the downloadable template (`docs/treasury-csv-template.csv`).

## Columns

| Column | Required | Description |
|--------|----------|-------------|
| `posted_date` | Yes | Settlement/posting date (`YYYY-MM-DD`) |
| `type` | Yes | Transaction type (see below) |
| `amount` | Yes | Absolute value in account currency (always positive in the file) |
| `balance` | No | Running balance after the row (used to set CSV account balance on import) |
| `description` | Yes | Raw bank descriptor / payee text |
| `account` | No | Account label (defaults to `Operating`; stored as `csv:<label>`) |
| `currency` | No | ISO currency code (defaults to `USD`) |

## Accepted `type` values

| `type` | Meaning |
|--------|---------|
| `debit` | Money leaving the account |
| `credit` | Money entering the account |
| `deposit` | Treated as inflow (same as `credit`) |

Matching is case-insensitive.

## Sign convention → `direction`

Imported rows are normalized before upsert:

1. **`type` → signed amount** (`lib/treasury/csv-import.ts`):
   - `credit` or `deposit` → negative amount (inflow)
   - `debit` (or any other value) → positive amount (outflow)

2. **`direction` in `treasury_transactions`** (`lib/treasury/normalize.ts`):
   - Positive amount → `out`
   - Negative amount → `in`

This matches the Plaid convention (positive = debit/outflow, negative = credit/inflow).

## Idempotency

Each row gets a deterministic `external_id` from `client_user_id`, account, date, amount, description, and row index. Re-uploading the same file increments `skipped`, not duplicates.

## Example

```csv
posted_date,type,amount,balance,description,account,currency
2025-01-03,debit,2500.00,47500.00,ACH DEBIT BIRCHWOOD PROPERTIES RENT,Operating,USD
2025-01-15,credit,12000.00,59500.00,WIRE IN ACME CORP PAYMENT,Operating,USD
```
