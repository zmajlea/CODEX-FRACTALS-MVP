/**
 * B30 gate — mobile shell stacking + topbar fit (static).
 * Usage: npm run gate:b30
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function log(msg: string) {
  console.log(`[gate-b30] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function pass(id: number, name: string, detail: string) {
  log(`PASS ${id}. ${name} — ${detail}`);
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function main() {
  log("B30 mobile shell gate");

  const shell = read("components/bcn/BcnContinuityShell.tsx");
  const client = read("components/platform/ClientShellFrame.tsx");
  const css = read("app/styles/continuity.css");
  const topbar = read("components/bcn/BcnTopbarContinuity.tsx");

  const railSibling = (src: string) =>
    /app-nav-scrim[\s\S]*?<aside[\s\S]*?app-rail[\s\S]*?<\/aside>[\s\S]*?className="app-row"/.test(
      src
    ) && !/<div className="app-row">[\s\S]*?<aside[\s\S]*?app-rail/.test(src);

  assert(railSibling(shell), "operator: rail still inside .app-row");
  assert(railSibling(client), "client: rail still inside .app-row");
  pass(1, "Rail + scrim siblings under .app (both shells)", "not trapped in .app-row");

  assert(!/z-index:\s*59\b/.test(css), "dead z-index:59 still present");
  assert(/z-index:\s*1000/.test(css) && /z-index:\s*1001/.test(css), "missing 1000/1001 scale");
  assert(css.includes("inset:49px 0 0 0"), "scrim inset 49px missing");
  assert(css.includes("inset:52px 0 0 0"), "R1 scrim inset 52px missing");
  assert(/z-index:\s*1010/.test(css), "topbar/appbar must sit above scrim for hamburger");
  pass(2, "Same-context z-scale + scrim inset + topbar above scrim", "1000/1001/1010");

  assert(/@media\s*\(\s*max-width:\s*560px\s*\)/.test(css), "≤560 media missing");
  assert(css.includes(".topbar .wm .wm-name"), "wm-name hide rule missing");
  assert(css.includes("text-overflow:ellipsis"), "recpill truncate missing");
  assert(css.includes(".topbar .ts-control"), "ts-control hide missing");
  pass(3, "Topbar ≤560: hide wordmark, truncate pill, hide A–A", "continuity.css");

  assert(css.includes(".app.rail-pinned .app-rail{ width:214px"), "desktop pin width");
  assert(css.includes(".app.rail-pinned .app-main{ margin-left:214px"), "desktop pin margin");
  assert(
    css.includes(".app:not(.rail-pinned) .app-rail:hover{ width:214px"),
    "desktop hover expand"
  );
  assert(!/\.app-row\s+\.app-rail/.test(css), "no .app-row .app-rail descendant selector");
  pass(4, "Desktop pin + hover-expand intact; no .app-row .app-rail", "pixel-identical path");

  assert(topbar.includes("navbtn") && topbar.includes("ts-control"), "topbar controls present");
  assert(shell.includes("onNavigate={() => setNavOpen(false)}"), "rail closes on navigate");
  pass(5, "Nav toggle + onNavigate close drawer", "routing path preserved");

  log("Done — static checks passed");
}

main();
