import { createHash } from "crypto";
import { normalizeMerchant } from "@/lib/treasury/normalize";
import type { NormalizedTxRow } from "@/lib/treasury/types";

const REQUIRED_HEADERS = [
  "posted_date",
  "type",
  "amount",
  "description",
] as const;

export type CsvParseResult = {
  rows: NormalizedTxRow[];
  accountLabels: Map<string, { balance: number | null; currency: string }>;
  skipped: number;
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

function csvTypeToAmount(type: string, amount: number): number {
  const t = type.toLowerCase();
  if (t === "credit" || t === "deposit") return -Math.abs(amount);
  return Math.abs(amount);
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

export function parseTreasuryCsv(
  csvText: string,
  clientUserId: string
): CsvParseResult {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one data row");
  }

  const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
  for (const req of REQUIRED_HEADERS) {
    if (!headers.includes(req)) {
      throw new Error(`Missing required column: ${req}`);
    }
  }

  const idx = (name: string) => headers.indexOf(name);
  const rows: NormalizedTxRow[] = [];
  const accountLabels = new Map<string, { balance: number | null; currency: string }>();
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const postedDate = cols[idx("posted_date")] ?? "";
    const type = cols[idx("type")] ?? "";
    const amountRaw = cols[idx("amount")] ?? "";
    const description = cols[idx("description")] ?? "";
    const account = cols[idx("account")] ?? "default";
    const currency = cols[idx("currency")] ?? "USD";
    const balanceRaw = idx("balance") >= 0 ? cols[idx("balance")] : "";

    if (!postedDate || !amountRaw || !description) {
      skipped += 1;
      continue;
    }

    const amount = csvTypeToAmount(type, Number(amountRaw.replace(/,/g, "")));
    const balance = balanceRaw ? Number(balanceRaw.replace(/,/g, "")) : null;
    const accountId = `csv:${account}`;

    accountLabels.set(account, { balance, currency });

    rows.push({
      external_id: hashExternalId(
        clientUserId,
        account,
        postedDate,
        amount,
        description,
        i
      ),
      account_id: accountId,
      posted_date: postedDate,
      amount,
      iso_currency_code: currency,
      raw_name: description,
      merchant_name: normalizeMerchant(description),
      pending: false,
      is_removed: false,
    });
  }

  return { rows, accountLabels, skipped };
}

export async function upsertCsvAccounts(
  admin: import("@supabase/supabase-js").SupabaseClient,
  clientUserId: string,
  accountLabels: Map<string, { balance: number | null; currency: string }>
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
