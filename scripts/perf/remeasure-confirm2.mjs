/**
 * Confirm-all remeasure against existing HCCLAIMPMT rule on gate client 4.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "https://codex-fractals-mvp.vercel.app";
const CLIENT_ID = "6d53f194-e71b-4965-aecc-eab9f81ed311";
const CLIENT_CONFIRM = "Ana Gate Client 4";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(OUT, { recursive: true });

for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  let k = t.slice(0, eq).trim(),
    v = t.slice(eq + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  }
);

function log(...a) {
  console.log("[confirm]", ...a);
}

async function sugCount(ruleId) {
  const { count } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("rule_id", ruleId);
  return count ?? 0;
}

async function txCount() {
  const { count } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", CLIENT_ID)
    .eq("is_removed", false);
  return count ?? 0;
}

const { data: rules } = await admin
  .from("treasury_rules")
  .select("id,match_merchant")
  .eq("client_user_id", CLIENT_ID);
const ruleId = rules?.find((r) => /HCCLAIMPMT/i.test(r.match_merchant || ""))?.id;
if (!ruleId) throw new Error("no HCCLAIMPMT rule — run import+create first");
log("ruleId", ruleId, "txs", await txCount(), "sug", await sugCount(ruleId));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(180000);
const hits = [];
page.on("response", async (response) => {
  const url = response.url();
  if (!url.includes("/api/operator/treasury/")) return;
  const req = response.request();
  let size = 0;
  try {
    size = (await response.body()).length;
  } catch {
    /* */
  }
  const timing = req.timing();
  hits.push({
    method: req.method(),
    path: url.replace(BASE, ""),
    status: response.status(),
    ms:
      timing.responseEnd > 0
        ? Math.round(timing.responseEnd - timing.requestStart)
        : null,
    size,
  });
});

await page.goto(`${BASE}/portal/login`);
await page.fill("#email", "ana_gate_operator@codexone.test");
await page.fill("#password", "ana_gate_2026!");
await page.click('form.auth-form button[type="submit"]');
await page.waitForURL(/\/operator/, { timeout: 60000 });
const url = (tab) =>
  `${BASE}/operator/treasury/clients/${CLIENT_ID}?tab=${tab}`;

const trials = [];
for (let i = 0; i < 3; i++) {
  // Re-apply to ensure suggestions exist
  await page.goto(url("rules"));
  await page
    .locator(".rule-card")
    .filter({ hasText: /HCCLAIMPMT/i })
    .getByRole("button", { name: /Re-apply/i })
    .click();
  await page.waitForTimeout(12000);
  let before = await sugCount(ruleId);
  log("trial", i + 1, "sug before", before);
  if (before < 50) {
    await page.waitForTimeout(10000);
    before = await sugCount(ruleId);
    log("sug after wait", before);
  }

  await page.goto(url("rules"));
  await page
    .locator(".rule-card")
    .filter({ hasText: /HCCLAIMPMT/i })
    .first()
    .click();
  await page.getByText(/All suggested/i).first().waitFor({ timeout: 60000 });
  hits.length = 0;
  const btn = page
    .locator("tr.triage-row")
    .filter({ hasText: /All suggested/i })
    .getByRole("button", { name: /Confirm all/i })
    .first();
  log("enabled", await btn.isEnabled());
  const t0 = Date.now();
  await btn.click();
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    if (hits.some((h) => h.method === "POST" && h.path.includes("bulk-label")))
      break;
    if (hits.some((h) => h.method === "POST" && h.path.includes("confirm-bucket")))
      break;
    await page.waitForTimeout(200);
  }
  await page
    .getByText(/Confirming/i)
    .waitFor({ state: "hidden", timeout: 300000 })
    .catch(() => {});
  const wall = Date.now() - t0;
  const after = await sugCount(ruleId);
  const posts = hits.filter((h) => h.method === "POST");
  trials.push({ wall, before, after, posts, hits: [...hits] });
  log("trial done", i + 1, "wall", wall, "before", before, "after", after, "posts", posts);
}

writeFileSync(join(OUT, "confirm-remeasure.json"), JSON.stringify(trials, null, 2));

// reset
await page.goto(url("profile"));
await page.getByRole("button", { name: /Reset client data/i }).first().click();
await page.getByText(/Type .* to confirm/i).waitFor();
await page.locator('input[autocomplete="off"]').last().fill(CLIENT_CONFIRM);
await page.getByRole("button", { name: /^Reset client data$/i }).last().click();
await page.waitForTimeout(10000);
log("final count", await txCount());
await browser.close();
