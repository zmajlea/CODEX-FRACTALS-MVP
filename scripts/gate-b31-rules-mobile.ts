/**
 * B31 gate — Rules phone sheets + desktop 3-col intact (static).
 * Usage: npm run gate:b31
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function log(msg: string) {
  console.log(`[gate-b31] ${msg}`);
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
  log("B31 Rules phone gate");

  const opLayout = read("app/operator/layout.tsx");
  const phoneCss = read("app/styles/rules-phone.css");
  const portal = read("components/operator/treasury/RulePhonePortal.tsx");
  const analyze = read("components/operator/treasury/RuleAmountAnalyzePopup.tsx");
  const panel = read("components/operator/treasury/TreasuryRulesPanel.tsx");
  const queue = read("components/operator/treasury/RuleQueuePhoneSheet.tsx");
  const txSheet = read("components/operator/treasury/TxActionPhoneSheet.tsx");
  const catSheet = read("components/operator/treasury/CategoryPhoneSheet.tsx");

  const shell = opLayout.indexOf('import "@/app/styles/shell-phone.css"');
  const rules = opLayout.indexOf('import "@/app/styles/rules-phone.css"');
  assert(shell >= 0 && rules >= 0 && shell < rules, "rules-phone must import after shell-phone");
  pass(1, "Import order", "shell-phone → rules-phone");

  assert(/z-index:\s*1020/.test(phoneCss), "sheet z-index 1020 missing");
  assert(/z-index:\s*1030/.test(phoneCss), "stacked sheet z-index 1030 missing");
  assert(portal.includes("createPortal"), "RulePhonePortal must portal");
  assert(portal.includes("document.body"), "portal target must be document.body");
  assert(portal.includes("document.body.style.overflow"), "body scroll lock required");
  assert(portal.includes('data-rm-portal="true"'), "portal marker missing");
  pass(2, "B30-hardened sheet layer", "portal to body, z≥1020, scroll lock");

  assert(phoneCss.includes("container-type: inline-size"), "rules-screen container-type");
  assert(portal.includes("Never render inside"), "container-type warning comment");
  // Sheets must not be JSX children of .rules-screen in panel source
  const screenBlock = panel.match(/className="rules-screen"[\s\S]*$/);
  assert(screenBlock, "rules-screen wrapper missing");
  assert(
    !/className="rules-screen"[\s\S]*?rm-overlay/.test(panel) &&
      !/className="rules-screen"[\s\S]*?<RulePhonePortal/.test(panel),
    "sheet overlay must not nest under .rules-screen"
  );
  // Queue/create sheets are siblings via portal components, not nested markup
  assert(panel.includes("RuleQueuePhoneSheet"), "queue sheet wired");
  assert(analyze.includes("RulePhonePortal"), "create sheet uses portal");
  assert(analyze.includes("isPhone"), "phone branch in analyze popup");
  assert(catSheet.includes("RulePhonePortal"), "category sheet portals");
  assert(txSheet.includes("RulePhonePortal"), "tx sheet portals");
  pass(3, "Sheets escape container-type", "portals + not nested under rules-screen");

  assert(analyze.includes("rule-analyze-panel--3col"), "desktop 3-col panel class");
  assert(panel.includes("triage-table"), "desktop triage table");
  assert(panel.includes('className="dtable"') || panel.includes("className=\"dtable\""), "desktop queue dtable");
  assert(
    /@media\s*\(\s*min-width:\s*1024px\s*\)/.test(phoneCss) &&
      phoneCss.includes("display: none !important"),
    "≥1024 must hide phone list chrome"
  );
  assert(
    !/@media\s*\(\s*min-width:\s*1024px\s*\)[\s\S]*rule-analyze-panel--3col/.test(
      phoneCss
    ),
    "phone CSS must not restyle 3-col analyze at ≥1024"
  );
  pass(4, "Desktop ≥1024 pixel-identical markers", "3-col + triage + dtable intact");

  assert(analyze.includes("Add conditions"), "progressive conditions copy");
  assert(analyze.includes("Save rule"), "review Save rule");
  assert(analyze.includes("Match merchant / payee"), "payee field label");
  assert(queue.includes("Confirm all"), "queue confirm all");
  assert(txSheet.includes("Make a rule from this transaction"), "tx entry copy");
  pass(5, "Notes copy / field labels", "no invented primary strings");

  log("Done — static checks passed");
}

main();
