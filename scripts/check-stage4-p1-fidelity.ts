/**
 * Stage 4 static gates — Spec 35 P1 fidelity.
 * Run: npx tsx scripts/check-stage4-p1-fidelity.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { formatSuMoney } from "../lib/treasury/format";

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

const ROOT = join(__dirname, "..");

if (formatSuMoney(8450, "out") !== "\u2212$8,450") {
  fail(`out amount must use U+2212: got ${formatSuMoney(8450, "out")}`);
}
if (formatSuMoney(184000, "in") !== "+$184,000") {
  fail(`in amount must be +$: got ${formatSuMoney(184000, "in")}`);
}

const record = readFileSync(
  join(ROOT, "components/operator/OperatorTreasuryClientRecord.tsx"),
  "utf8"
);
if (!record.includes('"profile"') || !record.includes("TreasuryProfilePanel")) {
  fail("Profile tab must exist");
}
if (!/id:\s*"overview"[\s\S]*id:\s*"profile"[\s\S]*id:\s*"connections"/.test(record)) {
  fail("Rail order must be Overview → Profile → Connections");
}
if (!record.includes('return "overview"')) {
  fail('parseInitialTab fallback must be "overview"');
}
// Header must not host Suspend/Revoke/Sync — only Profile / Connections
const headerChunk = record.slice(
  record.indexOf("record header"),
  record.indexOf('tab === "profile"')
);
if (headerChunk.includes("Suspend") || headerChunk.includes("Sync from bank")) {
  fail("record header must be identity only — no Suspend / Sync");
}
if (!record.includes("showSyncFromBank={hasBankConnection}")) {
  fail("Sync from bank must be gated to bank-connected clients");
}
// Duplicate CSV provenance removed from provenanceLine
if (/if \(csv\) parts\.push\("Imported from CSV"\)/.test(record)) {
  fail("provenanceLine must not duplicate Imported from CSV");
}

const profile = readFileSync(
  join(ROOT, "components/operator/treasury/TreasuryProfilePanel.tsx"),
  "utf8"
);
if (!profile.includes("Suspend") || !profile.includes("Revoke")) {
  fail("Suspend/Revoke must live on Profile");
}
if (
  !profile.includes("Business & Treasury Profile") &&
  !profile.includes("Business &amp; Treasury Profile")
) {
  fail("Profile title must match Ana verbatim");
}

const connections = readFileSync(
  join(ROOT, "components/operator/treasury/TreasuryConnectionsPanel.tsx"),
  "utf8"
);
if (!connections.includes("showSyncFromBank")) {
  fail("Connections must accept showSyncFromBank");
}

const txRow = readFileSync(
  join(ROOT, "components/operator/treasury/TreasuryTxRow.tsx"),
  "utf8"
);
if (!txRow.includes("formatSuMoney")) {
  fail("ledger rows must use formatSuMoney (always signed)");
}

console.log(
  "OK: Stage 4 — Profile above Overview; Suspend/Revoke on Profile; Sync gated; Ana amounts; no duplicate CSV"
);
