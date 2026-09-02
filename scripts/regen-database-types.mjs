/**
 * Regenerate lib/database.types.ts from the linked Supabase project.
 *
 * Why not plain `supabase gen types`?
 * 1. stderr — CLI upgrade banners must not be appended to the types file (Windows redirect trap).
 * 2. RPC optional-null — Postgres functions use DEFAULT NULL for optional filters; app code passes
 *    `null` explicitly. Supabase CLI v2.102+ emits `p_foo?: string` (undefined-only), which breaks
 *    `admin.rpc(..., { p_foo: null })` at compile time. Patches below restore `| null` to match SQL.
 * 3. TemporalObjectKind — convenience alias used by lib/temporal/*; not emitted by the CLI.
 *
 * Usage: npm run db:types
 */
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const PROJECT_ID = "tswdwmtrirdhtwqmsasz";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "lib/database.types.ts");

/** Replace every `needle` with `replacement`; skip if needle absent and replacement already present. */
function patchAll(source, needle, replacement) {
  if (!source.includes(needle)) {
    if (source.includes(replacement)) return source;
    throw new Error(`regen patch miss: expected ${JSON.stringify(needle)} in generated types`);
  }
  return source.replaceAll(needle, replacement);
}

/** Global optional-param patches: CLI `T` → `T | null` for treasury RPC filter args. */
const OPTIONAL_NULL_LINE_PATCHES = [
  {
    reason: "confirm-all / partial confirm passes null = all pending for rule",
    from: "p_transaction_ids?: string[]",
    to: "p_transaction_ids?: string[] | null",
  },
  {
    reason: "filter spine + rule match RPCs omit direction with null",
    from: "p_direction?: string",
    to: "p_direction?: string | null",
  },
  {
    reason: "date-range filters omit bound with null",
    from: "p_from?: string",
    to: "p_from?: string | null",
  },
  {
    reason: "date-range filters omit bound with null",
    from: "p_to?: string",
    to: "p_to?: string | null",
  },
  {
    reason: "query_summary client-wide when account omitted",
    from: "p_account_id?: string",
    to: "p_account_id?: string | null",
  },
  {
    reason: "tx chip counts multi-account filter",
    from: "p_account_ids?: string[]",
    to: "p_account_ids?: string[] | null",
  },
  {
    reason: "amount filter RPC args",
    from: "p_amount_exact?: number",
    to: "p_amount_exact?: number | null",
  },
  {
    reason: "amount filter RPC args",
    from: "p_amount_max?: number",
    to: "p_amount_max?: number | null",
  },
  {
    reason: "amount filter RPC args",
    from: "p_amount_min?: number",
    to: "p_amount_min?: number | null",
  },
  {
    reason: "payee search chip",
    from: "p_q?: string",
    to: "p_q?: string | null",
  },
  {
    reason: "rule queue exclude rejected bucket",
    from: "p_exclude_rejected_for_rule?: string",
    to: "p_exclude_rejected_for_rule?: string | null",
  },
  {
    reason: "rule match date window",
    from: "p_date_from?: string",
    to: "p_date_from?: string | null",
  },
  {
    reason: "rule match date window",
    from: "p_date_to?: string",
    to: "p_date_to?: string | null",
  },
  {
    reason: "monthly_outflows optional label filter",
    from: "p_label?: string",
    to: "p_label?: string | null",
  },
];

function applyRpcNullPatches(source) {
  let s = source;

  // Block patches — CLI marks these required; SQL accepts NULL with documented semantics.
  s = patchAll(
    s,
    "treasury_ensure_primary_cash_model: {\n        Args: {\n          p_account: string",
    "treasury_ensure_primary_cash_model: {\n        Args: {\n          p_account?: string | null"
  );
  s = patchAll(
    s,
    "treasury_monthly_by_category: {\n        Args: {\n          p_account_id: string",
    "treasury_monthly_by_category: {\n        Args: {\n          p_account_id?: string | null"
  );

  for (const { from, to } of OPTIONAL_NULL_LINE_PATCHES) {
    s = patchAll(s, from, to);
  }

  return s;
}

const raw = execSync(
  `npx supabase gen types typescript --project-id ${PROJECT_ID}`,
  { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
).trimEnd();

// Guard: never write CLI stderr/banners into the types file.
if (/^A new version of Supabase CLI/m.test(raw) || !raw.startsWith("export type Json")) {
  throw new Error("regen: unexpected gen types output (stderr leak or empty)");
}

let body = applyRpcNullPatches(raw);

body +=
  "\n\n/** App alias — lib/temporal/* imports this instead of Database['public']['Enums'][...] */\n";
body +=
  'export type TemporalObjectKind = Database["public"]["Enums"]["temporal_object_kind"];\n';

writeFileSync(out, body, "utf8");
console.log(`Wrote ${out} (${body.length} bytes, ${OPTIONAL_NULL_LINE_PATCHES.length + 2} RPC patches applied)`);
