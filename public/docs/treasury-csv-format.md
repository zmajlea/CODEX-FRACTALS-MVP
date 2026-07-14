# Treasury CSV import format

Operator CSV import uses the same column layout as the downloadable template.

See the full reference in the repo: `docs/treasury-csv-format.md`.

## Columns

| Column | Required | Description |
|--------|----------|-------------|
| `posted_date` | Yes | `YYYY-MM-DD` |
| `type` | Yes | `debit`, `credit`, or `deposit` |
| `amount` | Yes | Positive number in account currency |
| `balance` | No | Running balance after row |
| `description` | Yes | Bank descriptor / payee |
| `account` | No | Account label (default `Operating`) |
| `currency` | No | ISO code (default `USD`) |

## Sign convention

- `credit` / `deposit` → inflow (`direction = in`)
- `debit` → outflow (`direction = out`)

Amounts in the file are always positive; type determines sign before `direction` is stored.
