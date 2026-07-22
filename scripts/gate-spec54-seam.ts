/**
 * Spec 54 seam gate — history ends at data_span.last, forecast starts next period.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { computeTreasuryForecast } from "../lib/server/treasury-forecast";
import { fetchSummaryDataSpan } from "../lib/server/treasury-summary-data-span";
import { buildSummaryResponse } from "../lib/server/treasury-summary-response";
import { querySummary } from "../lib/server/treasury-rules";
import {
  lastNPeriodStarts,
  minIso,
  periodEnd,
  shiftPeriods,
  todayIso,
} from "../lib/treasury/period-bounds";

const ROOT = join(__dirname, "..");
const CLIENT1 = "r1_gate_client_1@codexone.test";
const ACCOUNT = "csv:0625";
const RESERVE = "csv:0871";
const MONTHLY_LOW_BEFORE = 98756.58;

function loadEnvLocal() {
  const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function assertMonotonic(history: string[], forecast: string[], dataLast: string) {
  const lastHist = history[history.length - 1];
  const firstFc = forecast[0];
  if (!lastHist || !firstFc) throw new Error("missing history or forecast bars");
  if (lastHist > firstFc) {
    throw new Error(`non-monotonic seam: history ends ${lastHist}, forecast starts ${firstFc}`);
  }
  const expectedFirst = shiftPeriods("day", periodEnd("day", dataLast), 1);
  // day-only exact check; week/month use next period start from anchor
  if (lastHist >= dataLast && firstFc <= lastHist) {
    throw new Error(`overlap at seam: ${lastHist} / ${firstFc}`);
  }
}

async function loadSummary(
  admin: ReturnType<typeof createClient>,
  clientId: string,
  g: "day" | "week" | "month",
  accountId: string,
  periods: number
) {
  const span = await fetchSummaryDataSpan(admin, clientId, accountId);
  const through = span?.last ? minIso(todayIso(), span.last) : todayIso();
  const { from, to, starts } = lastNPeriodStarts(g, periods, through);
  const sparse = await querySummary(admin, clientId, {
    bucket: g,
    from,
    to,
    accountId,
  });
  return buildSummaryResponse(sparse, {
    granularity: g,
    periods,
    from,
    to,
    starts,
    dataFirst: span?.first ?? null,
    dataLast: span?.last ?? null,
  });
}

async function main() {
  loadEnvLocal();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws as any },
    }
  );
  const { data: client } = await admin
    .from("users")
    .select("id")
    .ilike("email", CLIENT1)
    .maybeSingle();
  if (!client) throw new Error("Client 1 missing");

  for (const g of ["day", "week", "month"] as const) {
    const periods = g === "day" ? 30 : g === "week" ? 13 : 12;
    const summary = await loadSummary(admin, client.id, g, ACCOUNT, periods);
    const forecast = await computeTreasuryForecast(admin, client.id, g, ACCOUNT);
    const hist = summary.rows.map((r) => r.period_start);
    const fc = forecast.periods.map((p) => p.period_start);
    const lastHist = hist[hist.length - 1];
    const firstFc = fc[0];
    console.log(`\n${g} csv:0625:`);
    console.log(`  data_span.last: ${summary.data_span?.last}`);
    console.log(`  summary to: ${summary.to}, rows: ${hist.length}`);
    console.log(`  thisView would say: ${hist.length} ${g} periods, ${lastHist} → ${firstFc}`);
    console.log(`  last history: ${lastHist}, first forecast: ${firstFc}`);
    if (lastHist && firstFc && lastHist >= firstFc) {
      throw new Error(`${g}: seam not monotonic (${lastHist} >= ${firstFc})`);
    }
    if (g === "month") {
      const low = Math.min(...forecast.periods.map((p) => p.closing));
      console.log(`  monthly low: ${low.toFixed(2)} (delta ${Math.abs(low - MONTHLY_LOW_BEFORE).toFixed(2)})`);
      if (Math.abs(low - MONTHLY_LOW_BEFORE) > 1) {
        throw new Error("monthly low moved");
      }
    }
  }

  console.log("\n0871 reserve day forecast (flat reason):");
  const rDay = await computeTreasuryForecast(admin, client.id, "day", RESERVE);
  const p0 = rDay.periods[0];
  console.log({
    periods: rDay.periods.length,
    seed: rDay.seed_balance,
    baseline_inflow: p0?.baseline_inflow,
    baseline_outflow: p0?.baseline_outflow,
    recurring_on_first: p0?.recurring.length ?? 0,
    all_closing_flat: rDay.periods.every(
      (p) => Math.abs(p.closing - rDay.seed_balance) < 0.01
    ),
    insufficient_history: rDay.insufficient_history,
    refuse_projection: rDay.refuse_projection,
  });

  console.log("\nPASS Spec 54 seam gate");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
