/**
 * Confirm-all remeasure — accepts window.confirm; captures PATCH bulk-label.
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

// Ensure book + rule
let { data: rules } = await admin
  .from("treasury_rules")
  .select("id,match_merchant")
  .eq("client_user_id", CLIENT_ID);
let ruleId = rules?.find((r) => /HCCLAIMPMT/i.test(r.match_merchant || ""))?.id;
log("start txs", await txCount(), "rule", ruleId);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(180000);
page.on("dialog", async (d) => {
  log("dialog", d.type(), d.message().slice(0, 80));
  await d.accept();
});

const hits = [];
page.on("response", async (response) => {
  const u = response.url();
  if (!u.includes("/api/operator/treasury/")) return;
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
    path: u.replace(BASE, ""),
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
const clientUrl = (tab) =>
  `${BASE}/operator/treasury/clients/${CLIENT_ID}?tab=${tab}`;

if ((await txCount()) < 900 || !ruleId) {
  // reset + import + create
  await page.goto(clientUrl("profile"));
  await page.getByRole("button", { name: /Reset client data/i }).first().click();
  await page.getByText(/Type .* to confirm/i).waitFor();
  await page.locator('input[autocomplete="off"]').last().fill(CLIENT_CONFIRM);
  await page.getByRole("button", { name: /^Reset client data$/i }).last().click();
  await page.waitForTimeout(8000);
  await page.goto(clientUrl("connections"));
  await page
    .locator('input[type="file"]')
    .setInputFiles(join(ROOT, "docs/summit-ffm-0625.csv"));
  await page.getByText(/Import reconcile/i).waitFor({ timeout: 180000 });
  await page.goto(clientUrl("rules"));
  await page.getByRole("button", { name: /Create a rule manually/i }).click();
  await page.locator(".rule-analyze-backdrop").waitFor();
  await page
    .locator('.rule-analyze-panel label:has-text("Payee contains") input')
    .fill("HCCLAIMPMT");
  const cat = page
    .locator(
      '.rule-analyze-panel .catpick input, .rule-analyze-panel label:has-text("Category") input'
    )
    .first();
  await cat.fill("Claims");
  await cat.press("Enter");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Review$/i }).click();
  await page
    .locator(".rule-analyze-summary")
    .getByText(/will be suggested/i)
    .waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: /^Create rule$/i }).click();
  await page
    .locator(".rule-analyze-backdrop")
    .waitFor({ state: "hidden", timeout: 180000 });
  await page.waitForTimeout(5000);
  ({ data: rules } = await admin
    .from("treasury_rules")
    .select("id,match_merchant")
    .eq("client_user_id", CLIENT_ID));
  ruleId = rules?.find((r) => /HCCLAIMPMT/i.test(r.match_merchant || ""))?.id;
  log("created rule", ruleId);
}
if (!ruleId) throw new Error("no rule");

const trials = [];
for (let i = 0; i < 3; i++) {
  await page.goto(clientUrl("rules"));
  await page
    .locator(".rule-card")
    .filter({ hasText: /HCCLAIMPMT/i })
    .getByRole("button", { name: /Re-apply/i })
    .click();
  await page.waitForTimeout(15000);
  const before = await sugCount(ruleId);
  log("trial", i + 1, "before", before);

  await page.goto(clientUrl("rules"));
  await page
    .locator(".rule-card")
    .filter({ hasText: /HCCLAIMPMT/i })
    .first()
    .click();
  await page.getByText(/All suggested/i).first().waitFor({ timeout: 60000 });
  hits.length = 0;
  const t0 = Date.now();
  await page
    .locator("tr.triage-row")
    .filter({ hasText: /All suggested/i })
    .getByRole("button", { name: /Confirm all/i })
    .first()
    .click();
  // wait for PATCH bulk-label
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    if (
      hits.some(
        (h) =>
          h.method === "PATCH" &&
          h.path.includes("bulk-label") &&
          h.status
      )
    )
      break;
    await page.waitForTimeout(200);
  }
  await page
    .getByText(/Confirming/i)
    .waitFor({ state: "hidden", timeout: 300000 })
    .catch(() => {});
  const wall = Date.now() - t0;
  const after = await sugCount(ruleId);
  const bulk = hits.filter(
    (h) => h.method === "PATCH" && h.path.includes("bulk-label")
  );
  trials.push({ wall, before, after, bulk, hits: [...hits] });
  log(
    "trial done",
    i + 1,
    "wall",
    wall,
    "before",
    before,
    "after",
    after,
    "bulk",
    bulk
  );
}

writeFileSync(join(OUT, "confirm-remeasure.json"), JSON.stringify(trials, null, 2));
await page.goto(clientUrl("profile"));
await page.getByRole("button", { name: /Reset client data/i }).first().click();
await page.getByText(/Type .* to confirm/i).waitFor();
await page.locator('input[autocomplete="off"]').last().fill(CLIENT_CONFIRM);
await page.getByRole("button", { name: /^Reset client data$/i }).last().click();
await page.waitForTimeout(10000);
log("final count", await txCount());
await browser.close();

const walls = trials.map((t) => t.wall).sort((a, b) => a - b);
const med = walls[Math.floor(walls.length / 2)];
log("MEDIAN confirm-all", med, "walls", walls);
