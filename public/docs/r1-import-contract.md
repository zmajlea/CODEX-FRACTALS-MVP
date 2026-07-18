# R1 Treasury CSV import contract

**R1-only.** Column auto-detection and multi-format translation are R2. For R1, every bank export must be normalized into this shape (manually or with the Claude prompt below) before upload.

## Canonical columns (exact order for headerless files)

| # | Column | Required | Notes |
|---|--------|----------|-------|
| 1 | Posted Date | Yes | ISO datetime with offset, e.g. `2026-03-31T05:00:00+00`. UTC calendar date is stored. |
| 2 | Type | Yes | One of seven values below |
| 3 | Description | Yes | Payee / bank descriptor |
| 4 | Amount | Yes | Signed in Summit exports (negative = out, positive = in). Legacy MVP files may use unsigned amounts + type. |
| 5 | Account | Yes* | Account id, e.g. `0617`, `0625`. *May be zeroed in source; supply `account_label` on import. |
| 6 | Notes | No | Operator notes |
| 7 | Balance | No | Running balance after row |
| 8 | Raw Description | No | Merchant source when present; preferred over Description for labeling |

Header row labels are flexible (`Posted Date`, `posted_date`, etc.) after normalization.

## Type values (7)

`deposit` · `withdrawal` · `transfer` · `fee` · `check` · `refund` · `other`

## Sign rule

**Before import (Spec 32):** when Amounts are signed and a Balance column is present, Amount is checked against consecutive Balance deltas in **file order** (≥95% of discriminating pairs; `|amount| ≤ $0.04` skipped as non-discriminating; mismatches stay in the denominator). Result:

- **as-stated** → import as written
- **inverted** → Amounts flipped, announced in the reconcile panel
- **unreconcilable** → import refused (HTTP 400); no rows written

If Balance is missing or has fewer than 10 comparable pairs, Type is used for signed files (deposits vs withdrawals must carry opposite unanimous signs). `transfer` / `other` are excluded from that check. Legacy **unsigned** Absolute Amounts skip Balance verification; direction comes from Type as before.

**Signed files** (any negative amount in the Amount column, after Spec 32 correction):

- The **sign is truth**. Do not re-sign in Claude or Excel.
- Negative = money out; positive = money in.
- Applies to `transfer` and `refund` — direction cannot be inferred from type alone.

**Unsigned files** (legacy MVP template — all amounts positive):

- `deposit`, `refund`, `credit` → inflow
- `withdrawal`, `fee`, `check`, `debit` → outflow
- `transfer`, `other` → **skipped** (direction unknown). Normalize to signed amounts or assign a known type before upload.

## Stored metadata

Bank `Type` is stored in `treasury_transactions.plaid_category` for R1. **This is not a Plaid category** — it holds the source bank type string. R2 will add a dedicated `source_type` column.

## Reconcile report

After import, the operator UI shows:

- Rows read · imported · skipped · duplicates ignored
- Sum of inflows · outflows · net (bank convention: positive in, negative out)
- **Sign convention** message (Balance- or Type-verified; notes if Amounts were flipped)
- Sign/type mismatches · rows needing direction
- Date range · accounts touched · end balances

Use this to verify against your source spreadsheet.

## Test files (known targets)

| File | Account | Rows | Inflows | Outflows | End balance |
|------|---------|------|---------|----------|-------------|
| `docs/summit-ffm-0625.csv` | 0625 | 1,086 | $248,142 | −$156,407 | $95,916 |
| `docs/summit-ffm-0617.csv` | 0617 | 1,121 | $118,409 | −$117,669 | $3,000 |

Cross-account internal transfers net to $0 (0617 transfer out ≈ 0625 transfer in ≈ $114,177).

Legacy demo: `docs/demo-treasury-summit.csv` (unsigned MVP format, still supported).

---

## Claude prompt — normalize any export to R1 shape

Copy everything below the line into Claude with your raw bank CSV attached.

---

You are preparing a bank transaction CSV for import into Summit Treasury (R1 contract). Output **only** a CSV file — no commentary inside the file.

**Required columns in this exact order:**

`Posted Date,Type,Description,Amount,Account,Notes,Balance,Raw Description`

**Rules (hard):**

1. **Preserve every transaction row.** Do not dedupe, summarize, or drop rows.
2. **Never re-sign amounts.** If the source has signed amounts (negatives for outflows), keep them exactly. If the source is unsigned, output positive amounts and set Type correctly.
3. **Posted Date:** ISO 8601 with timezone offset when time is available, e.g. `2024-03-15T06:00:00+00`. Use the bank's posting date.
4. **Type:** map to exactly one of: `deposit`, `withdrawal`, `transfer`, `fee`, `check`, `refund`, `other`.
5. **Account:** use the real account identifier (e.g. `0617`, `0625`). Never zero it out.
6. **Raw Description:** copy the fullest merchant/payee string available; duplicate Description if that's all you have.
7. **Balance:** include running balance when the source provides it.

**After generating the CSV, reply with a reconcile line I can check against my sheet:**

`Rows: N | Inflows: $X | Outflows: -$Y | Net: $Z`

Use bank convention: inflows positive, outflows negative. Do not convert to internal ledger signs.

This format is **R1-only**. A future release will add automatic column detection.
