/**
 * Spec 50 gate: dual-account import on gate client 3, prove seed_balance per account,
 * then leave reset to a follow-up call.
 *
 * Usage: npx tsx scripts/gate-spec50-forecast-scope.ts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { parseTreasuryCsv, upsertCsvAccounts } from "../lib/treasury/csv-import";
import { upsertTransactions } from "../lib/treasury/upsert-transactions";
import {
  computeTreasuryForecast,
  emptyTreasuryForecast,
} from "../lib/server/treasury-forecast";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLIENT_EMAIL = "r1_gate_client_3@codexone.test";

function loadEnvLocal() {
  const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function importFile(admin: ReturnType<typeof createClient>, clientId: string, path: string) {
  const csv = readFileSync(join(ROOT, path), "utf8");
  const parsed = parseTreasuryCsv(csv, clientId);
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  const r = await upsertTransactions(admin, clientId, parsed.rows, "csv");
  console.log(path, r);
}

async function main() {
  loadEnvLocal();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      realtime: { transport: ws as any },
    }
  );

  const { data: client } = await admin
    .from("users")
    .select("id, email, display_name")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();
  if (!client) throw new Error("gate client 3 missing");
  console.log("client", client.id);

  // Empty-book response shape (zero accounts path)
  const empty = emptyTreasuryForecast("month");
  if (!empty.insufficient_history || empty.periods.length !== 0) {
    throw new Error("emptyTreasuryForecast shape wrong");
  }
  console.log("empty shape OK");

  await importFile(admin, client.id, "docs/summit-ffm-0625.csv");
  await importFile(admin, client.id, "docs/summit-ffm-0617.csv");

  const { data: accounts } = await admin
    .from("treasury_accounts")
    .select("account_id, name, current_balance")
    .eq("client_user_id", client.id);
  console.log("accounts", accounts);
  if ((accounts?.length ?? 0) < 2) throw new Error("expected 2 accounts");

  const a0625 = accounts!.find((a) => a.account_id.includes("0625") || a.name === "0625");
  const a0617 = accounts!.find((a) => a.account_id.includes("0617") || a.name === "0617");
  if (!a0625 || !a0617) throw new Error("missing 0625 or 0617");

  const f0625 = await computeTreasuryForecast(admin, client.id, "month", a0625.account_id);
  const f0617 = await computeTreasuryForecast(admin, client.id, "month", a0617.account_id);

  console.log("0625", {
    seed: f0625.seed_balance,
    bal: a0625.current_balance,
    span: f0625.data_span,
    low: f0625.periods.length
      ? Math.min(...f0625.periods.map((p) => p.closing))
      : null,
    periods: f0625.periods.length,
  });
  console.log("0617", {
    seed: f0617.seed_balance,
    bal: a0617.current_balance,
    span: f0617.data_span,
    low: f0617.periods.length
      ? Math.min(...f0617.periods.map((p) => p.closing))
      : null,
    periods: f0617.periods.length,
  });

  if (Math.abs(f0625.seed_balance - Number(a0625.current_balance)) > 0.02) {
    throw new Error("0625 seed_balance != account balance");
  }
  if (Math.abs(f0617.seed_balance - Number(a0617.current_balance)) > 0.02) {
    throw new Error("0617 seed_balance != account balance");
  }
  if (Math.abs(f0625.seed_balance - f0617.seed_balance) < 0.02) {
    throw new Error("seed_balance did not change between accounts");
  }

  const low0625 = f0625.periods.length
    ? Math.min(...f0625.periods.map((p) => p.closing))
    : null;
  const low0617 = f0617.periods.length
    ? Math.min(...f0617.periods.map((p) => p.closing))
    : null;
  if (low0625 != null && low0617 != null && Math.abs(low0625 - low0617) < 0.02) {
    console.warn("low points equal — unusual but check transfer inflation was all-accounts only");
  }

  // Old all-accounts sum must not equal either scoped seed
  const sumBal =
    Number(a0625.current_balance) + Number(a0617.current_balance);
  if (Math.abs(f0625.seed_balance - sumBal) < 0.02) {
    throw new Error("0625 seed equals all-accounts sum — scope failed");
  }

  console.log("PASS engine scope", { clientId: client.id, sumBal });

  console.log("\n=== Spec 54 — day/week on gate client 3 (0625 + 0617 only) ===");
  for (const acct of [a0625, a0617]) {
    for (const g of ["day", "week"] as const) {
      const f = await computeTreasuryForecast(admin, client.id, g, acct.account_id);
      const low = f.periods.length
        ? Math.min(...f.periods.map((p) => p.closing))
        : null;
      console.log(`  ${acct.account_id} ${g}: refuse=${Boolean(f.refuse_projection)} periods=${f.periods.length} low=${low?.toFixed(2) ?? "n/a"} span=${f.data_span?.last ?? "?"}`);
      if (f.refuse_projection || f.periods.length === 0) {
        throw new Error(`${acct.account_id} ${g} must project on gate client 3`);
      }
    }
  }
  console.log("PASS Spec 54 day/week per-account on gate client 3");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
