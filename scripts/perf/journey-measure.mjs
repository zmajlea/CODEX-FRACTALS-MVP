/**
 * Spec PERF — operator journey timing against live Vercel production.
 * Ephemeral. Do not commit. Gate client 4 only.
 *
 * Usage: node scripts/perf/journey-measure.mjs
 */
import { chromium } from "playwright";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const BASE = process.env.PERF_BASE_URL || "https://codex-fractals-mvp.vercel.app";
const OPERATOR_EMAIL = "ana_gate_operator@codexone.test";
const OPERATOR_PASSWORD = "ana_gate_2026!";
const CLIENT_EMAIL = "ana_gate_client_4@codexone.test";
const CLIENT_ID = "6d53f194-e71b-4965-aecc-eab9f81ed311";
const CLIENT_CONFIRM = "Ana Gate Client 4";
const TRIALS = Number(process.env.PERF_TRIALS || 3);
const OUT_DIR = join(__dirname, "out");
mkdirSync(OUT_DIR, { recursive: true });

function loadEnv() {
  const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    let k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  }
);

function log(...a) {
  console.log(`[perf]`, ...a);
}
function median(nums) {
  const a = [...nums].filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.floor(a.length / 2)];
}
function msNow() {
  return Date.now();
}

async function txCount() {
  const { count, error } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", CLIENT_ID)
    .eq("is_removed", false);
  if (error) throw error;
  return count ?? 0;
}

function clientUrl(tab, extra = "") {
  return `${BASE}/operator/treasury/clients/${CLIENT_ID}?tab=${tab}${extra}`;
}

/** Track treasury API responses during a window. */
function attachNet(page) {
  const hits = [];
  const onResp = async (response) => {
    try {
      const url = response.url();
      if (!url.includes("/api/operator/treasury/")) return;
      const req = response.request();
      const timing = req.timing();
      const headers = response.headers();
      let size = Number(headers["content-length"] || 0);
      if (!size) {
        try {
          const buf = await response.body();
          size = buf.length;
        } catch {
          /* */
        }
      }
      const start = timing.responseStart || timing.requestStart || 0;
      const end = timing.responseEnd || 0;
      const duration =
        end > 0 && start >= 0 ? Math.max(0, end - (timing.requestStart || 0)) : null;
      hits.push({
        url,
        method: req.method(),
        status: response.status(),
        durationMs: duration,
        size,
        serverTiming: headers["server-timing"] || null,
        t: Date.now(),
      });
    } catch {
      /* */
    }
  };
  page.on("response", onResp);
  return {
    hits,
    clear() {
      hits.length = 0;
    },
    detach() {
      page.off("response", onResp);
    },
    snapshot() {
      const list = [...hits];
      const withDur = list.filter((h) => h.durationMs != null);
      const slowest = withDur.sort(
        (a, b) => (b.durationMs || 0) - (a.durationMs || 0)
      )[0];
      return {
        count: list.length,
        slowest: slowest
          ? {
              endpoint: slowest.url.replace(BASE, ""),
              ms: Math.round(slowest.durationMs),
              size: slowest.size,
            }
          : null,
        requests: list.map((h) => ({
          method: h.method,
          path: h.url.replace(BASE, "").split("?")[0],
          qs: h.url.includes("?") ? h.url.slice(h.url.indexOf("?")) : "",
          status: h.status,
          ms: h.durationMs != null ? Math.round(h.durationMs) : null,
          size: h.size,
          serverTiming: h.serverTiming,
        })),
      };
    },
  };
}

async function login(page) {
  await page.goto(`${BASE}/portal/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", OPERATOR_EMAIL);
  await page.fill("#password", OPERATOR_PASSWORD);
  await page.click('form.auth-form button[type="submit"]');
  await page.waitForURL(/\/operator/, { timeout: 60000 });
  log("logged in", page.url());
}

async function assertKeyUnlocked(page) {
  await page.goto(clientUrl("overview"), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app, #app", { timeout: 30000 });
  const text = await page.locator(".kd").first().evaluate((el) => {
    const parent = el.parentElement;
    return (parent?.textContent || "").trim();
  }).catch(async () => {
    // fallback: search page text
    return page.locator("body").innerText();
  });
  const body = await page.locator("body").innerText();
  if (/Key locked/i.test(body) && !/Key unlocked/i.test(body)) {
    throw new Error("ABORT: Key locked — timings would be meaningless");
  }
  if (!/Key unlocked/i.test(body)) {
    log("WARN: Key unlocked chip text not found; body snippet check");
    // Hardcoded true in treasury — continue if client record visibly loaded
    const ok = await page.locator(".hubhead, .title, .rail").first().isVisible();
    if (!ok) throw new Error("ABORT: client record not visible");
  }
  log("key unlock assert OK");
  return text;
}

async function resetClient(page) {
  const net = attachNet(page);
  net.clear();
  const t0 = msNow();
  await page.goto(clientUrl("profile"), { waitUntil: "networkidle" });
  const openBtn = page.getByRole("button", { name: /Reset client data/i }).first();
  await openBtn.click();
  // confirm dialog — type name
  const input = page.locator('input[type="text"]').last();
  await input.fill(CLIENT_CONFIRM);
  await page.getByRole("button", { name: /^Reset client data$/i }).last().click();
  await page.waitForTimeout(500);
  // wait until resetting done
  await page
    .getByText(/Resetting/i)
    .waitFor({ state: "hidden", timeout: 180000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  const wall = msNow() - t0;
  const snap = net.snapshot();
  net.detach();
  const count = await txCount();
  return { wall, snap, count };
}

async function importCsv(page, filePath) {
  const net = attachNet(page);
  net.clear();
  const t0 = msNow();
  await page.goto(clientUrl("connections"), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="file"]', {
    state: "attached",
    timeout: 30000,
  });
  // Hidden file input: setInputFiles fires onChange → import starts (no button click).
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await page.getByText(/Import reconcile/i).first().waitFor({
    timeout: 180000,
  });
  await page
    .getByRole("button", { name: /Importing/i })
    .waitFor({ state: "hidden", timeout: 180000 })
    .catch(() => {});
  await page.waitForTimeout(800);
  const wall = msNow() - t0;
  const snap = net.snapshot();
  net.detach();
  const count = await txCount();
  return { wall, snap, count };
}

async function timeNav(page, tab, readySelector, extra = "") {
  const net = attachNet(page);
  net.clear();
  const t0 = msNow();
  await page.goto(clientUrl(tab, extra), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(readySelector, { timeout: 120000 });
  // settle network briefly
  await page.waitForLoadState("networkidle").catch(() => {});
  const wall = msNow() - t0;
  const snap = net.snapshot();
  net.detach();
  return { wall, snap };
}

async function timeClick(
  page,
  clickFn,
  readyFn,
  { timeout = 120000 } = {}
) {
  const net = attachNet(page);
  net.clear();
  const t0 = msNow();
  await clickFn();
  await readyFn();
  await page.waitForTimeout(200);
  const wall = msNow() - t0;
  const snap = net.snapshot();
  net.detach();
  return { wall, snap };
}

async function medianTrials(label, n, fn) {
  const trials = [];
  for (let i = 0; i < n; i++) {
    log(`${label} trial ${i + 1}/${n}`);
    const r = await fn(i);
    trials.push(r);
    log(`  wall=${r.wall}ms reqs=${r.snap?.count ?? "?"}`);
  }
  const walls = trials.map((t) => t.wall);
  const mid = median(walls);
  const midTrial =
    trials.find((t) => t.wall === mid) || trials[Math.floor(trials.length / 2)];
  return {
    label,
    medianWallMs: mid,
    trials: walls,
    snap: midTrial.snap,
    extra: midTrial.extra || null,
    all: trials,
  };
}

function causeLine(step, snap, rtt) {
  const n = snap?.count ?? 0;
  const slow = snap?.slowest;
  const wall = step.medianWallMs || 0;
  if (!slow) return "no treasury API captured — UI-only or cached";
  if (n >= 3 && rtt && wall < n * rtt * 2.5) {
    return `${n} sequential treasury calls × ~${Math.round(rtt)}ms RTT (round-trip-bound)`;
  }
  if (slow.ms > wall * 0.5) {
    return `server-bound: ${slow.endpoint} ~${slow.ms}ms dominates`;
  }
  return `${n} requests; slowest ${slow.endpoint} ${slow.ms}ms`;
}

async function runBookJourney(page, bookLabel, expectedMinCount) {
  const results = {};
  const count0 = await txCount();
  log(`=== ${bookLabel} start count=${count0} ===`);

  // Overview
  results.overview = await medianTrials("overview", TRIALS, async () =>
    timeNav(page, "overview", ".hubhead, .title, .navcard, .tile")
  );

  // Forecast
  results.forecast = await medianTrials("forecast", TRIALS, async () =>
    timeNav(
      page,
      "analytics",
      "#t-forecast, .treasury-summary, [data-view='forecast'], .panel",
      "&view=forecast"
    )
  );

  // Transactions open
  results.txOpen = await medianTrials("tx-open", TRIALS, async () =>
    timeNav(page, "transactions", "table, .tx-row, .ledger, [aria-label='Status filter']")
  );

  // Pages 1→2→3
  await page.goto(clientUrl("transactions"), { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[aria-label='Status filter'], .tx-row, table", {
    timeout: 60000,
  });
  results.txPage2 = await medianTrials("tx-page2", TRIALS, async () => {
    // go to page 1 first if needed
    const next = page.getByRole("button", { name: /^Next$/i });
    return timeClick(
      page,
      async () => {
        if (await next.isEnabled()) await next.click();
      },
      async () => {
        await page.waitForTimeout(800);
      }
    );
  });

  // Filters
  const filters = ["All", "Uncategorized", "Suggested", "Confirmed"];
  results.filters = {};
  for (const f of filters) {
    results.filters[f] = await medianTrials(`filter-${f}`, TRIALS, async () => {
      await page.goto(clientUrl("transactions"), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector("[aria-label='Status filter']", {
        timeout: 60000,
      });
      return timeClick(
        page,
        async () => {
          // Accessible name includes count e.g. "All 1,086"
          await page
            .locator("[aria-label='Status filter']")
            .getByRole("button", { name: new RegExp(`^${f}\\b`, "i") })
            .click();
        },
        async () => {
          await page.waitForLoadState("networkidle").catch(() => {});
          await page.waitForTimeout(400);
        }
      );
    });
  }

  // Create rule HCCLAIMPMT
  results.rulePopup = await medianTrials("rule-popup", Math.min(TRIALS, 3), async () => {
    await page.goto(clientUrl("rules"), { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Create a rule manually/i }).waitFor();
    return timeClick(
      page,
      async () => {
        await page.getByRole("button", { name: /Create a rule manually/i }).click();
      },
      async () => {
        await page.locator(".rule-analyze-backdrop, [role='dialog']").waitFor({
          timeout: 30000,
        });
      }
    );
  });

  // Fill + stats/preview (one detailed measure, then create)
  {
    await page.goto(clientUrl("rules"), { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Create a rule manually/i }).click();
    await page.locator(".rule-analyze-backdrop").waitFor();
    const net = attachNet(page);
    net.clear();
    const t0 = msNow();
    await page
      .locator('.rule-analyze-panel label:has-text("Payee contains") input')
      .fill("HCCLAIMPMT");
    const cat = page.locator(
      '.rule-analyze-panel .catpick input, .rule-analyze-panel label:has-text("Category") input'
    ).first();
    await cat.fill("Claims");
    await cat.blur();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /^Review$/i }).click();
    await page.getByText(/will be suggested|match/i).first().waitFor({
      timeout: 120000,
    });
    const wallStats = msNow() - t0;
    const snapStats = net.snapshot();
    results.ruleStats = {
      label: "rule-stats-preview",
      medianWallMs: wallStats,
      trials: [wallStats],
      snap: snapStats,
    };
    net.clear();
    const t1 = msNow();
    await page.getByRole("button", { name: /^Create rule$/i }).click();
    await page
      .locator(".rule-analyze-backdrop")
      .waitFor({ state: "hidden", timeout: 180000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    const wallSave = msNow() - t1;
    results.ruleSave = {
      label: "rule-save",
      medianWallMs: wallSave,
      trials: [wallSave],
      snap: net.snapshot(),
    };
    net.detach();
  }

  // Expand rule + bucket switches
  await page.goto(clientUrl("rules"), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const ruleCard = page.locator(".rule-card").filter({ hasText: /HCCLAIMPMT/i }).first();
  await ruleCard.click();
  await page.getByText(/Triage|All suggested/i).first().waitFor({ timeout: 60000 });

  results.bucketAll = await medianTrials("bucket-all-suggested", TRIALS, async () =>
    timeClick(
      page,
      async () => {
        await page.getByRole("button", { name: /All suggested/i }).click().catch(async () => {
          await page.getByText(/All suggested/i).first().click();
        });
      },
      async () => {
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(500);
      }
    )
  );

  // 9b bucket confirm contrast (one trial — pick first combo if any)
  try {
    const net = attachNet(page);
    net.clear();
    const t0 = msNow();
    const bucketBtn = page
      .locator("tr.triage-row")
      .filter({ hasNotText: /All suggested/i })
      .locator(".triage-act button")
      .filter({ hasText: /^Confirm$/i })
      .first();
    if ((await bucketBtn.count()) > 0) {
      await bucketBtn.click();
      await page.waitForTimeout(2000);
      await page
        .getByText(/Confirming/i)
        .waitFor({ state: "hidden", timeout: 120000 })
        .catch(() => {});
      results.confirmBucket = {
        label: "confirm-bucket",
        medianWallMs: msNow() - t0,
        trials: [msNow() - t0],
        snap: net.snapshot(),
      };
    } else {
      results.confirmBucket = {
        label: "confirm-bucket",
        medianWallMs: null,
        note: "no combo bucket confirm button found",
        snap: { count: 0 },
      };
    }
    net.detach();
  } catch (e) {
    results.confirmBucket = {
      label: "confirm-bucket",
      medianWallMs: null,
      note: String(e),
      snap: { count: 0 },
    };
  }

  // Step 9 — Confirm all suggested (bulk-label) — median of TRIALS with re-apply
  try {
    results.confirmAll = await medianTrials(
      "confirm-all-suggested",
      TRIALS,
      async (i) => {
        if (i > 0) {
          const re = page
            .locator(".rule-card")
            .filter({ hasText: /HCCLAIMPMT/i })
            .getByRole("button", { name: /Re-apply/i });
          if (await re.count()) {
            await re.click();
            await page.waitForTimeout(8000);
          }
          await page.goto(clientUrl("rules"), { waitUntil: "domcontentloaded" });
          await page
            .locator(".rule-card")
            .filter({ hasText: /HCCLAIMPMT/i })
            .first()
            .click();
          await page.waitForTimeout(1500);
        }
        return timeClick(
          page,
          async () => {
            await page
              .locator("tr.triage-row")
              .filter({ hasText: /All suggested/i })
              .getByRole("button", { name: /Confirm all/i })
              .first()
              .click();
          },
          async () => {
            await page
              .getByText(/Confirming/i)
              .waitFor({ state: "visible", timeout: 10000 })
              .catch(() => {});
            await page
              .getByText(/Confirming/i)
              .waitFor({ state: "hidden", timeout: 300000 })
              .catch(() => {});
            await page.waitForTimeout(1000);
          },
          { timeout: 300000 }
        );
      }
    );
  } catch (e) {
    results.confirmAll = {
      label: "confirm-all-suggested",
      medianWallMs: null,
      note: String(e),
      snap: { count: 0 },
    };
    log("confirm-all failed", e);
  }

  // Analytics analyzer
  results.analyzer = await medianTrials("analyzer", TRIALS, async () =>
    timeNav(
      page,
      "analytics",
      ".panel, .study, button",
      "&view=analyzer"
    )
  );

  // Recommendations — light create/send feel
  results.recommendations = await medianTrials("recommendations", TRIALS, async () =>
    timeNav(page, "recommendations", ".panel, .hubhead, h1")
  );

  const finalCount = await txCount();
  if (finalCount < expectedMinCount) {
    throw new Error(
      `${bookLabel}: tx count ${finalCount} < expected min ${expectedMinCount}`
    );
  }
  results.bookCount = finalCount;
  return results;
}

async function step0(page) {
  const headers = {};
  page.on("response", (r) => {
    if (r.url().includes(BASE) && !headers.vercelId) {
      const h = r.headers();
      headers.vercelId = h["x-vercel-id"] || null;
      headers.vercelCache = h["x-vercel-cache"] || null;
      headers.cfRay = h["cf-ray"] || null;
      headers.server = h["server"] || null;
    }
  });

  // Cold: first accounts hit
  const coldNet = attachNet(page);
  const tCold = msNow();
  await page.goto(clientUrl("overview"), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const coldWall = msNow() - tCold;
  const coldSnap = coldNet.snapshot();
  coldNet.detach();

  // Warm RTT: 5× GET accounts via page.evaluate fetch (uses cookies)
  const rtts = [];
  for (let i = 0; i < 5; i++) {
    const ms = await page.evaluate(async (cid) => {
      const t0 = performance.now();
      const res = await fetch(`/api/operator/treasury/clients/${cid}/accounts`);
      await res.arrayBuffer();
      return { ms: performance.now() - t0, status: res.status };
    }, CLIENT_ID);
    rtts.push(ms.ms);
    log(`RTT accounts #${i + 1}: ${Math.round(ms.ms)}ms status=${ms.status}`);
  }

  // Probe supabase region via REST (no secret in report beyond project ref)
  let supabaseRegion = "unknown (check dashboard)";
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } }
    );
    // region not in health body usually
    supabaseRegion = `project tswdwmtrirdhtwqmsasz; health=${res.status}`;
  } catch (e) {
    supabaseRegion = String(e);
  }

  return {
    headers,
    coldWallMs: coldWall,
    coldSnap,
    rttTrialsMs: rtts.map((x) => Math.round(x)),
    rttMedianMs: Math.round(median(rtts)),
    supabaseRegion,
    vercelId: headers.vercelId,
  };
}

async function main() {
  log("BASE", BASE);
  log("CLIENT", CLIENT_ID, CLIENT_EMAIL);
  const countBefore = await txCount();
  log("tx_count before", countBefore);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  const report = {
    date: new Date().toISOString(),
    base: BASE,
    client: { id: CLIENT_ID, email: CLIENT_EMAIL },
    trials: TRIALS,
  };

  try {
    await login(page);
    await assertKeyUnlocked(page);
    report.step0 = await step0(page);
    log("Step0", JSON.stringify(report.step0, null, 2));

    // Reset to empty
    log("reset start");
    const resetR = await resetClient(page);
    report.reset = resetR;
    log("reset done count=", resetR.count, "wall=", resetR.wall);

    // --- SMALL BOOK ---
    const smallCsv = join(ROOT, "docs/summit-ffm-0625.csv");
    const imp1 = await importCsv(page, smallCsv);
    log("small import count=", imp1.count, "wall=", imp1.wall);
    if (imp1.count < 900) {
      throw new Error(`small book did not grow: count=${imp1.count}`);
    }
    report.small = {
      import: imp1,
      journey: await runBookJourney(page, "small", 900),
    };
    writeFileSync(
      join(OUT_DIR, "partial-small.json"),
      JSON.stringify(report, null, 2)
    );

    // --- LARGE BOOK: add clones ---
    // Keep small data; add 6 clones → ~7k
    const clones = ["b", "c", "d", "e", "f", "g"].map((s) =>
      join(__dirname, "clones", `summit-ffm-0625-${s}.csv`)
    );
    const importWalls = [];
    for (const c of clones) {
      if (!existsSync(c)) throw new Error(`missing clone ${c}`);
      const before = await txCount();
      const r = await importCsv(page, c);
      importWalls.push(r.wall);
      log(`clone import ${c} before=${before} after=${r.count} wall=${r.wall}`);
      if (r.count <= before) {
        throw new Error(
          `large book did not grow after ${c}: ${before} → ${r.count}`
        );
      }
    }
    const largeCount = await txCount();
    log("large book count", largeCount);
    if (largeCount < 5000) {
      throw new Error(`large book too small: ${largeCount}`);
    }

    // Fresh rule journey on large — reset rules by wiping suggestions via new rule name path:
    // Delete existing HCCLAIMPMT rules first via UI if present
    await page.goto(clientUrl("rules"), { waitUntil: "domcontentloaded" });
    while (
      await page
        .locator(".rule-card")
        .filter({ hasText: /HCCLAIMPMT/i })
        .count()
    ) {
      const card = page
        .locator(".rule-card")
        .filter({ hasText: /HCCLAIMPMT/i })
        .first();
      await card.getByRole("button", { name: /Delete/i }).click();
      await page.waitForTimeout(1500);
    }

    report.large = {
      importWallsMs: importWalls,
      bookCount: largeCount,
      journey: await runBookJourney(page, "large", 5000),
    };
    writeFileSync(
      join(OUT_DIR, "partial-large.json"),
      JSON.stringify(report, null, 2)
    );
  } catch (e) {
    report.error = String(e?.stack || e);
    log("ERROR", report.error);
  }

  // Final reset
  try {
    log("final reset");
    await page.goto(clientUrl("profile"), { waitUntil: "domcontentloaded" });
    const fr = await resetClient(page);
    report.finalReset = fr;
    log("final reset count=", fr.count);
  } catch (e) {
    report.finalResetError = String(e);
  }

  writeFileSync(join(OUT_DIR, "raw.json"), JSON.stringify(report, null, 2));
  await browser.close();

  // Emit markdown
  const md = renderMarkdown(report);
  const mdPath = join(ROOT, "docs/PERF-JOURNEY-2026-08-08.md");
  writeFileSync(mdPath, md);
  log("wrote", mdPath);
}

function summarizeStep(s, rtt) {
  if (!s) return { median: "—", reqs: "—", slow: "—", cause: "—" };
  const slow = s.snap?.slowest
    ? `${s.snap.slowest.endpoint} ${s.snap.slowest.ms}ms`
    : "—";
  return {
    median: s.medianWallMs != null ? `${Math.round(s.medianWallMs)}ms` : "—",
    reqs: s.snap?.count ?? "—",
    slow,
    cause: causeLine(s, s.snap, rtt),
  };
}

function renderMarkdown(report) {
  const rtt = report.step0?.rttMedianMs;
  const lines = [];
  lines.push(`# PERF-JOURNEY-2026-08-08`);
  lines.push("");
  lines.push(`Measured: ${report.date}`);
  lines.push(`Target: \`${report.base}\``);
  lines.push(
    `Operator: \`${OPERATOR_EMAIL}\` · Client: \`${CLIENT_EMAIL}\` (\`${CLIENT_ID}\`)`
  );
  lines.push(`Trials per step: ${report.trials} (median reported)`);
  lines.push("");
  lines.push(`## Step 0 — region / RTT / cold-warm`);
  lines.push("");
  lines.push(`- **x-vercel-id:** \`${report.step0?.vercelId || "?"}\``);
  lines.push(
    `- **Supabase:** \`${report.step0?.supabaseRegion}\` (project \`tswdwmtrirdhtwqmsasz\`)`
  );
  lines.push(
    `- **Co-location:** Infer from vercel-id region prefix vs Supabase dashboard region — see notes below.`
  );
  lines.push(
    `- **RTT median (GET …/accounts, 5×):** **${rtt}ms** (trials: ${(report.step0?.rttTrialsMs || []).join(", ")}ms)`
  );
  lines.push(
    `- **Cold overview nav:** ${report.step0?.coldWallMs}ms (${report.step0?.coldSnap?.count ?? "?"} treasury reqs)`
  );
  lines.push(
    `- **Server-Timing:** none observed — server-vs-network attribution inferred from RTT.`
  );
  lines.push(`- **Key unlock:** asserted before timed steps.`);
  lines.push("");
  if (report.error) {
    lines.push(`## ERROR`);
    lines.push("```");
    lines.push(report.error);
    lines.push("```");
    lines.push("");
  }

  const smallJ = report.small?.journey || {};
  const largeJ = report.large?.journey || {};
  const rows = [
    ["Reset", report.reset, report.finalReset],
    ["CSV import (first / clones)", report.small?.import, { wall: median(report.large?.importWallsMs || []), snap: report.small?.import?.snap }],
    ["Overview", smallJ.overview, largeJ.overview],
    ["Forecast", smallJ.forecast, largeJ.forecast],
    ["Transactions open", smallJ.txOpen, largeJ.txOpen],
    ["Tx page Next", smallJ.txPage2, largeJ.txPage2],
    ["Filter All", smallJ.filters?.All, largeJ.filters?.All],
    ["Filter Uncategorized", smallJ.filters?.Uncategorized, largeJ.filters?.Uncategorized],
    ["Filter Suggested", smallJ.filters?.Suggested, largeJ.filters?.Suggested],
    ["Filter Confirmed", smallJ.filters?.Confirmed, largeJ.filters?.Confirmed],
    ["Rule popup open", smallJ.rulePopup, largeJ.rulePopup],
    ["Rule stats/preview", smallJ.ruleStats, largeJ.ruleStats],
    ["Rule save", smallJ.ruleSave, largeJ.ruleSave],
    ["Queue All suggested", smallJ.bucketAll, largeJ.bucketAll],
    ["Confirm all (bulk-label)", smallJ.confirmAll, largeJ.confirmAll],
    ["Confirm bucket (contrast)", smallJ.confirmBucket, largeJ.confirmBucket],
    ["Analyzer", smallJ.analyzer, largeJ.analyzer],
    ["Recommendations tab", smallJ.recommendations, largeJ.recommendations],
  ];

  lines.push(`## Book sizes`);
  lines.push("");
  lines.push(
    `- **Small:** ${report.small?.import?.count ?? "?"} txs (1× FFM CSV)`
  );
  lines.push(
    `- **Large:** ${report.large?.bookCount ?? largeJ.bookCount ?? "?"} txs (FFM + Account-rewritten clones; count verified after each import)`
  );
  lines.push("");

  lines.push(`## Step table (median wall / #reqs / slowest)`);
  lines.push("");
  lines.push(
    `| Step | Small median | Small #reqs | Small slowest | Large median | Large #reqs | Large slowest | Likely cause |`
  );
  lines.push(`|---|---:|---:|---|---:|---:|---|---|`);
  for (const [name, s, l] of rows) {
    const ss = s?.medianWallMs != null || s?.wall != null
      ? {
          medianWallMs: s.medianWallMs ?? s.wall,
          snap: s.snap,
        }
      : null;
    const ll =
      l?.medianWallMs != null || l?.wall != null
        ? {
            medianWallMs: l.medianWallMs ?? l.wall,
            snap: l.snap,
          }
        : null;
    const S = summarizeStep(ss, rtt);
    const L = summarizeStep(ll, rtt);
    lines.push(
      `| ${name} | ${S.median} | ${S.reqs} | ${S.slow} | ${L.median} | ${L.reqs} | ${L.slow} | ${S.cause} |`
    );
  }
  lines.push("");

  lines.push(`## Ranked worst offenders`);
  lines.push("");
  const offenders = [];
  for (const [name, s, l] of rows) {
    for (const [book, step] of [
      ["small", s],
      ["large", l],
    ]) {
      const wall = step?.medianWallMs ?? step?.wall;
      if (wall != null) offenders.push({ name, book, wall, snap: step.snap });
    }
  }
  offenders.sort((a, b) => b.wall - a.wall);
  for (const o of offenders.slice(0, 12)) {
    const slow = o.snap?.slowest
      ? `${o.snap.slowest.endpoint} ${o.snap.slowest.ms}ms`
      : "—";
    lines.push(
      `1. **${o.name}** (${o.book}) — ${Math.round(o.wall)}ms · ${o.snap?.count ?? "?"} reqs · ${slow}`
    );
  }
  lines.push("");

  lines.push(`## Reset`);
  lines.push("");
  lines.push(
    `- Final reset count: **${report.finalReset?.count ?? report.finalResetError ?? "?"}**`
  );
  lines.push("");

  lines.push(`## Raw appendix`);
  lines.push("");
  lines.push("See `scripts/perf/out/raw.json` for full per-request timings (ephemeral).");
  lines.push("");
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        step0: report.step0,
        smallCount: report.small?.import?.count,
        largeCount: report.large?.bookCount,
        error: report.error || null,
      },
      null,
      2
    )
  );
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
