/**
 * Stage 3 static gates: answer action, snap-only client renderer, inbox Answered.
 * Run: npx tsx scripts/check-stage3-questions.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  actionToStatus,
  canTransition,
} from "../lib/treasury/recommendation-status";

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

if (actionToStatus("answer", "sent") !== "done") {
  fail("answer must move sent → done");
}
if (!canTransition("sent", "done", "client")) {
  fail("client must be allowed sent → done (question answer)");
}
if (canTransition("sent", "done", "operator")) {
  fail("operator must not answer via sent → done");
}

const clientUi = readFileSync(
  join(__dirname, "../components/treasury/TreasuryClientRecommendations.tsx"),
  "utf8"
);
if (!clientUi.includes("FrozenEvidenceList")) {
  fail("client UI must render FrozenEvidenceList (snap only)");
}
if (clientUi.includes("resolveEvidenceLive")) {
  fail("client UI must never re-resolve evidence");
}
if (!clientUi.includes('action: "answer"') && !clientUi.includes('"answer"')) {
  fail("client UI must offer answer action");
}

const frozen = readFileSync(
  join(__dirname, "../lib/treasury/recommendation-ui.tsx"),
  "utf8"
);
if (!frozen.includes("snap only") && !frozen.includes("from snap")) {
  fail("FrozenEvidenceList must document snap-only rendering");
}

const inbox = readFileSync(
  join(__dirname, "../lib/server/treasury-recommendations.ts"),
  "utf8"
);
if (!inbox.includes('"Answered"') && !inbox.includes("Answered")) {
  fail("operator inbox must surface Answered questions");
}

const migration = readFileSync(
  join(
    __dirname,
    "../supabase/migrations/20260718140000_treasury_question_response.sql"
  ),
  "utf8"
);
if (!migration.includes("client_response") || !migration.includes("responded_at")) {
  fail("migration must add client_response + responded_at");
}
if (!migration.includes("sent_at is not null")) {
  fail("migration must freeze content after send (questions have no sealed_at)");
}

console.log("OK: Stage 3 — answer → done; snap-only evidence; inbox Answered; freeze after send");
