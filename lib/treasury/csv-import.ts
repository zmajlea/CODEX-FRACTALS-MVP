import { createHash } from "crypto";
import { amountToDirection, normalizeMerchant } from "@/lib/treasury/normalize";
import {
  classifySignConvention,
  SignConventionError,
  type SignConventionRow,
  type SignConventionVerdict,
} from "@/lib/treasury/sign-convention";
import type { NormalizedTxRow } from "@/lib/treasury/types";

/**
 * Internal amount convention (Plaid): positive = outflow, negative = inflow.
 * Summit signed CSV: source negative = money out → internal = -source.
 * Legacy unsigned CSV: type-based via csvTypeToAmount (credit/deposit → inflow).
 * Spec 32: Balance (or Type) verifies Amount sign before that mapping; inverted files are flipped first.
 */

const REQUIRED_CANONICAL = ["posted_date", "type", "amount", "description"] as const;

/** Canonical column order for headerless Summit FFM files. */
const HEADERLESS_COLUMNS = [
  "posted_date",
  "type",
  "description",
  "amount",
  "account",
  "notes",
  "balance",
  "raw_description",
] as const;

const ALIAS_TO_CANONICAL: Record<string, string> = {
  posted_date: "posted_date",
  date: "posted_date",
  post_date: "posted_date",
  description: "description",
  amount: "amount",
  type: "type",
  trans_type: "type",
  transaction_type: "type",
  account: "account",
  account_number: "account",
  balance: "balance",
  available_balance: "balance",
  raw_description: "raw_description",
  notes: "notes",
  currency: "currency",
};

const INFLOW_TYPES = new Set(["deposit", "refund", "credit"]);
const OUTFLOW_TYPES = new Set(["withdrawal", "fee", "check", "debit"]);
const UNKNOWN_UNSIGNED_TYPES = new Set(["transfer", "other"]);

export type SkippedDetail = { row: number; reason: string };

export type TreasuryImportReconcile = {
  rowsRead: number;
  imported: number;
  skipped: number;
  skippedDetails: SkippedDetail[];
  duplicatesIgnored: number;
  inflowSum: number;
  outflowSum: number;
  net: number;
  signTypeMismatches: number;
  rowsNeedingDirection: number;
  dateMin: string | null;
  dateMax: string | null;
  accountsTouched: string[];
  warnings: string[];
  headerless: boolean;
  endBalances: Record<string, number | null>;
  signConvention: SignConventionVerdict;
};

export type CsvParseResult = {
  rows: NormalizedTxRow[];
  accountLabels: Map<
    string,
    { balance: number | null; currency: string; latestDate: string | null }
  >;
  reconcile: Omit<
    TreasuryImportReconcile,
    "imported" | "duplicatesIgnored"
  >;
};

export type ParseTreasuryCsvOptions = {
  /** Used when account column is empty / zero (tab-encoded exports). */
  accountLabel?: string;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ /g, "_")
    .replace(/-/g, "_");
}

function resolveCanonicalHeader(normalized: string): string | null {
  return ALIAS_TO_CANONICAL[normalized] ?? null;
}

function buildColumnIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const canonical = resolveCanonicalHeader(normalizeHeader(headers[i]!));
    if (canonical && !map.has(canonical)) {
      map.set(canonical, i);
    }
  }
  return map;
}

function countRecognizedHeaders(headers: string[]): number {
  const seen = new Set<string>();
  for (const h of headers) {
    const canonical = resolveCanonicalHeader(normalizeHeader(h));
    if (canonical) seen.add(canonical);
  }
  return seen.size;
}

function detectSignedFile(
  dataLines: string[],
  colIndex: Map<string, number>
): boolean {
  const amountIdx = colIndex.get("amount");
  if (amountIdx === undefined) return false;
  for (const line of dataLines) {
    const cols = parseCsvLine(line);
    const raw = cols[amountIdx]?.replace(/,/g, "").trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isNaN(n) && n < 0) return true;
  }
  return false;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

/** Legacy unsigned path: credit/deposit → inflow (negative internal). */
function csvTypeToAmount(type: string, amount: number): number {
  const t = type.toLowerCase().trim();
  if (INFLOW_TYPES.has(t)) return -Math.abs(amount);
  return Math.abs(amount);
}

function parsePostedDateUtc(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  let iso = trimmed;
  if (/[+-]\d{2}$/.test(iso)) {
    iso = iso.replace(/([+-]\d{2})$/, "$1:00");
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isEmptyAccount(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  const n = Number(t.replace(/,/g, ""));
  return !Number.isNaN(n) && n === 0;
}

function hashExternalId(
  clientUserId: string,
  account: string,
  postedDate: string,
  amount: number,
  description: string,
  rowIndex: number
): string {
  const raw = `${clientUserId}|${account}|${postedDate}|${amount}|${description}|${rowIndex}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function signTypeMismatch(type: string, sourceAmount: number): boolean {
  const t = type.toLowerCase().trim();
  if (OUTFLOW_TYPES.has(t) || t === "withdrawal") {
    return sourceAmount > 0;
  }
  if (INFLOW_TYPES.has(t)) {
    return sourceAmount < 0;
  }
  return false;
}

function internalToBankAmount(internalAmount: number): number {
  return -internalAmount;
}

export function parseTreasuryCsv(
  csvText: string,
  clientUserId: string,
  options: ParseTreasuryCsvOptions = {}
): CsvParseResult {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 1) {
    throw new Error("CSV file is empty");
  }

  const warnings: string[] = [];
  let headerless = false;
  let dataStartIndex = 0;
  let colIndex: Map<string, number>;

  const firstCols = parseCsvLine(lines[0]!);
  if (countRecognizedHeaders(firstCols) >= 3) {
    colIndex = buildColumnIndex(firstCols);
    dataStartIndex = 1;
  } else {
    headerless = true;
    warnings.push("No header row detected; used canonical column order");
    colIndex = new Map(
      HEADERLESS_COLUMNS.map((name, i) => [name, i] as const)
    );
    dataStartIndex = 0;
  }

  for (const req of REQUIRED_CANONICAL) {
    if (!colIndex.has(req)) {
      throw new Error(`Missing required column: ${req}`);
    }
  }

  const dataLines = lines.slice(dataStartIndex);
  if (dataLines.length < 1) {
    throw new Error("CSV must include at least one data row");
  }

  const getCol = (cols: string[], name: string) => {
    const idx = colIndex.get(name);
    return idx !== undefined ? (cols[idx] ?? "") : "";
  };

  function resolveAccountRaw(accountRaw: string): string {
    if (!isEmptyAccount(accountRaw)) return accountRaw.trim() || "default";
    if (options.accountLabel?.trim()) return options.accountLabel.trim();
    if (headerless) return "";
    return "default";
  }

  // Spec 32 — classify Amount sign against Balance (file order) or Type before mapping.
  const signRows: SignConventionRow[] = [];
  for (let i = 0; i < dataLines.length; i++) {
    const cols = parseCsvLine(dataLines[i]!);
    const accountResolved = resolveAccountRaw(getCol(cols, "account"));
    if (!accountResolved) continue;
    const amount = parseAmount(getCol(cols, "amount"));
    if (amount === null) continue;
    const balanceRaw = getCol(cols, "balance");
    const balance = balanceRaw.trim() ? parseAmount(balanceRaw) : null;
    signRows.push({
      account: accountResolved,
      amount,
      balance,
      type: getCol(cols, "type").trim().toLowerCase() || "other",
    });
  }

  const signConvention = classifySignConvention(signRows);
  if (signConvention.kind === "unreconcilable") {
    throw new SignConventionError(signConvention);
  }
  const amountFlip = signConvention.kind === "inverted" ? -1 : 1;
  if (signConvention.kind === "inverted") {
    warnings.push(signConvention.message);
  }

  const signedMode = detectSignedFile(dataLines, colIndex);

  const rows: NormalizedTxRow[] = [];
  const accountLabels = new Map<
    string,
    { balance: number | null; currency: string; latestDate: string | null }
  >();
  const skippedDetails: SkippedDetail[] = [];
  let signTypeMismatches = 0;
  let rowsNeedingDirection = 0;
  let inflowSum = 0;
  let outflowSum = 0;
  let dateMin: string | null = null;
  let dateMax: string | null = null;
  const accountsTouched = new Set<string>();
  const endBalances: Record<string, number | null> = {};

  for (let i = 0; i < dataLines.length; i++) {
    const fileRow = dataStartIndex + i + 1;
    const cols = parseCsvLine(dataLines[i]!);

    const postedRaw = getCol(cols, "posted_date");
    const typeRaw = getCol(cols, "type");
    const amountRaw = getCol(cols, "amount");
    const description = getCol(cols, "description");
    const rawDescription = getCol(cols, "raw_description");
    let accountRaw = getCol(cols, "account");
    const currency = getCol(cols, "currency") || "USD";
    const balanceRaw = getCol(cols, "balance");

    if (isEmptyAccount(accountRaw)) {
      if (options.accountLabel?.trim()) {
        accountRaw = options.accountLabel.trim();
      } else if (headerless) {
        skippedDetails.push({
          row: fileRow,
          reason: "missing account (supply account_label for empty account column)",
        });
        continue;
      } else {
        accountRaw = "default";
      }
    }

    const account = accountRaw.trim() || "default";

    if (!postedRaw.trim()) {
      skippedDetails.push({ row: fileRow, reason: "missing posted date" });
      continue;
    }

    const postedDate = parsePostedDateUtc(postedRaw);
    if (!postedDate) {
      skippedDetails.push({
        row: fileRow,
        reason: `unparseable date: ${postedRaw}`,
      });
      continue;
    }

    const sourceAmountRaw = parseAmount(amountRaw);
    if (sourceAmountRaw === null || sourceAmountRaw === 0) {
      skippedDetails.push({ row: fileRow, reason: "missing or zero amount" });
      continue;
    }
    const sourceAmount = sourceAmountRaw * amountFlip;

    if (!description.trim() && !rawDescription.trim()) {
      skippedDetails.push({ row: fileRow, reason: "missing description" });
      continue;
    }

    const type = typeRaw.trim().toLowerCase() || "other";
    let internalAmount: number;
    let bankAmount: number;

    if (signedMode) {
      internalAmount = -sourceAmount;
      bankAmount = sourceAmount;
      if (signTypeMismatch(type, sourceAmount)) {
        signTypeMismatches += 1;
      }
    } else {
      if (UNKNOWN_UNSIGNED_TYPES.has(type)) {
        rowsNeedingDirection += 1;
        skippedDetails.push({
          row: fileRow,
          reason: `direction unknown (type=${type}, unsigned file)`,
        });
        continue;
      }
      internalAmount = csvTypeToAmount(type, Math.abs(sourceAmount));
      bankAmount = internalToBankAmount(internalAmount);
    }

    const merchantSource = rawDescription.trim() || description.trim();
    const balance = balanceRaw ? parseAmount(balanceRaw) : null;

    accountsTouched.add(account);
    if (dateMin === null || postedDate < dateMin) dateMin = postedDate;
    if (dateMax === null || postedDate > dateMax) dateMax = postedDate;

    if (bankAmount > 0) inflowSum += bankAmount;
    else if (bankAmount < 0) outflowSum += bankAmount;

    const prev = accountLabels.get(account);
    if (
      !prev ||
      !prev.latestDate ||
      postedDate >= prev.latestDate
    ) {
      accountLabels.set(account, {
        balance,
        currency,
        latestDate: postedDate,
      });
      if (balance !== null) endBalances[account] = balance;
    } else if (prev && balance !== null && prev.latestDate) {
      accountLabels.set(account, prev);
    } else if (!prev) {
      accountLabels.set(account, { balance, currency, latestDate: postedDate });
    }

    rows.push({
      external_id:       hashExternalId(
        clientUserId,
        account,
        postedDate,
        internalAmount,
        merchantSource,
        dataStartIndex + i
      ),
      account_id: `csv:${account}`,
      posted_date: postedDate,
      amount: internalAmount,
      iso_currency_code: currency,
      raw_name: merchantSource,
      merchant_name: normalizeMerchant(merchantSource),
      // R1: holds the source bank 'Type' (deposit|withdrawal|transfer|fee|check|refund|other), not a Plaid category. R2: move to a dedicated source_type column.
      plaid_category: type || null,
      pending: false,
      is_removed: false,
    });
  }

  const reconcile: CsvParseResult["reconcile"] = {
    rowsRead: dataLines.length,
    skipped: skippedDetails.length,
    skippedDetails,
    inflowSum: Math.round(inflowSum * 100) / 100,
    outflowSum: Math.round(outflowSum * 100) / 100,
    net: Math.round((inflowSum + outflowSum) * 100) / 100,
    signTypeMismatches,
    rowsNeedingDirection,
    dateMin,
    dateMax,
    accountsTouched: [...accountsTouched].sort(),
    warnings,
    headerless,
    endBalances,
    signConvention,
  };

  return { rows, accountLabels, reconcile };
}

export async function upsertCsvAccounts(
  admin: import("@supabase/supabase-js").SupabaseClient,
  clientUserId: string,
  accountLabels: Map<
    string,
    { balance: number | null; currency: string; latestDate?: string | null }
  >
) {
  for (const [label, meta] of accountLabels) {
    const accountId = `csv:${label}`;
    const { data: existing } = await admin
      .from("treasury_accounts")
      .select("account_id")
      .eq("client_user_id", clientUserId)
      .eq("account_id", accountId)
      .maybeSingle();

    if (existing) {
      const balancePatch: Record<string, number | null> = {};
      if (meta.balance != null) {
        balancePatch.current_balance = meta.balance;
        balancePatch.available_balance = meta.balance;
      }
      if (Object.keys(balancePatch).length > 0) {
        await admin
          .from("treasury_accounts")
          .update(balancePatch)
          .eq("client_user_id", clientUserId)
          .eq("account_id", accountId)
          .eq("source", "csv");
      }
    } else {
      await admin.from("treasury_accounts").insert({
        source: "csv",
        plaid_item_id: null,
        client_user_id: clientUserId,
        account_id: accountId,
        name: label,
        type: "depository",
        subtype: "checking",
        current_balance: meta.balance,
        available_balance: meta.balance,
        iso_currency_code: meta.currency,
      });
    }
  }
}

/** Sum bank-convention flows for reconcile cross-checks (positive in, negative out). */
export function bankAmountFromInternal(internalAmount: number): number {
  return internalToBankAmount(internalAmount);
}

/** Exposed for tests: direction from internal amount. */
export { amountToDirection, csvTypeToAmount, SignConventionError };
