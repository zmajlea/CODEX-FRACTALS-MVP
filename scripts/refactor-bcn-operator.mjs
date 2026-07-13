/**
 * Ubiquitous language refactor: FF→BCN, Distributor→Operator.
 * Run AFTER directory renames (lib/bcn, components/bcn, app/operator, etc.)
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "agent-transcripts"]);
const SKIP_FILES = new Set(["refactor-bcn-operator.mjs", "package-lock.json"]);

const REPLACEMENTS = [
  // Paths & routes (longest first)
  ["@/components/ff/", "@/components/bcn/"],
  ["@/lib/ff/", "@/lib/bcn/"],
  ["/api/distributor/", "/api/operator/"],
  ["/client/ff", "/client/bcn"],
  ["/distributor", "/operator"],
  ["app/distributor", "app/operator"],
  ["components/ff/", "components/bcn/"],
  ["lib/ff/", "lib/bcn/"],
  // RPCs & tables
  ["set_distributor_module_branding", "set_operator_module_branding"],
  ["list_distributor_client_invites", "list_operator_client_invites"],
  ["list_distributor_staff_directory", "list_operator_staff_directory"],
  ["list_distributor_modules", "list_operator_modules"],
  ["invite_distributor_staff", "invite_operator_staff"],
  ["set_distributor_module", "set_operator_module"],
  ["create_distributor_tenant", "create_operator_tenant"],
  ["distributor_modules", "operator_modules"],
  ["is_distributor", "is_operator"],
  ["assign_distributor", "assign_operator"],
  // Platform components
  ["DistributorRegistryTable", "OperatorRegistryTable"],
  ["DistributorModuleToggles", "OperatorModuleToggles"],
  ["DistributorDashboard", "OperatorDashboard"],
  // BCN component prefixes
  ["FfThemeStyleInjector", "BcnThemeStyleInjector"],
  ["FfTopbarContinuity", "BcnTopbarContinuity"],
  ["FfContinuityShell", "BcnContinuityShell"],
  ["FfWizardModule", "BcnWizardModule"],
  ["FfThemeContext", "BcnThemeContext"],
  ["FfBrandMarks", "BcnBrandMarks"],
  ["useFfThemeOptional", "useBcnThemeOptional"],
  ["useFfTheme", "useBcnTheme"],
  ["FfThemeProvider", "BcnThemeProvider"],
  ["FfRailGroup", "BcnRailGroup"],
  ["FfRailItem", "BcnRailItem"],
  ["FfIconName", "BcnIconName"],
  ["FfIcon", "BcnIcon"],
  ["FfCrest", "BcnCrest"],
  ["FfNib", "BcnNib"],
  ["FfRail", "BcnRail"],
  ["FfTopbar", "BcnTopbar"],
  // Brand presets (ff4 before ff1)
  ['[data-brand="ff4"]', '[data-brand="bcn4"]'],
  ['[data-brand="ff3"]', '[data-brand="bcn3"]'],
  ['[data-brand="ff2"]', '[data-brand="bcn2"]'],
  ['[data-brand="ff1"]', '[data-brand="bcn1"]'],
  ['"ff4"', '"bcn4"'],
  ['"ff3"', '"bcn3"'],
  ['"ff2"', '"bcn2"'],
  ['"ff1"', '"bcn1"'],
  ["'ff4'", "'bcn4'"],
  ["'ff3'", "'bcn3'"],
  ["'ff2'", "'bcn2'"],
  ["'ff1'", "'bcn1'"],
  // Module slug defaults
  ["default 'ff'", "default 'bcn'"],
  ['default "ff"', 'default "bcn"'],
  ["?? \"ff\"", "?? \"bcn\""],
  ["?? 'ff'", "?? 'bcn'"],
  ["slug: \"ff\"", "slug: \"bcn\""],
  ["slug ?? \"ff\"", "slug ?? \"bcn\""],
  ["modules[0]?.slug ?? \"ff\"", "modules[0]?.slug ?? \"bcn\""],
  ["moduleSlug, modules[0]?.slug ?? \"ff\"", "moduleSlug, modules[0]?.slug ?? \"bcn\""],
  // UI strings
  ["Financial Firefighter", "Business Continuity Navigator"],
  ["A Financial Firefighter solution", "A Business Continuity Navigator solution"],
  // Role tier (quoted only)
  ['"distributor"', '"operator"'],
  ["'distributor'", "'operator'"],
  ["| \"distributor\"", "| \"operator\""],
  ["CommercialTier = \"global_admin\" | \"distributor\"", "CommercialTier = \"global_admin\" | \"operator\""],
  ["mode: \"client\" | \"distributor\"", "mode: \"client\" | \"operator\""],
  ["FfContinuityShellMode = \"client\" | \"distributor\"", "BcnContinuityShellMode = \"client\" | \"operator\""],
  ["Distributor may not", "Operator may not"],
  ["Distributor dashboard", "Operator dashboard"],
  ["distributor dashboard", "operator dashboard"],
  ["distributor layout", "operator layout"],
  ["distributor tenant", "operator tenant"],
  ["Distributor ", "Operator "],
  ["distributor ", "operator "],
  ["parseFfLoginRoute", "parseBcnLoginRoute"],
  ["showFfSolutionLine", "showBcnSolutionLine"],
  ["ffOwnsChrome", "bcnOwnsChrome"],
  ["data-ff-tenant", "data-bcn-tenant"],
  ["[ff-email]", "[bcn-email]"],
  ["ff-email", "bcn-email"],
  ["ff-card", "bcn-card"],
  ["CPA ", "Operator "],
  ["CPA/", "Operator/"],
];

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else files.push(p);
  }
  return files;
}

function shouldProcess(file) {
  const rel = path.relative(ROOT, file);
  if (SKIP_FILES.has(path.basename(file))) return false;
  if (rel.startsWith("supabase" + path.sep + "migrations")) return false;
  if (rel.includes("IA_CONTEXT")) return false;
  const ext = path.extname(file).toLowerCase();
  return [".ts", ".tsx", ".js", ".mjs", ".css", ".sql", ".md", ".json"].includes(ext);
}

function apply(content) {
  let out = content;
  for (const [from, to] of REPLACEMENTS) {
    out = out.split(from).join(to);
  }
  return out;
}

const files = walk(ROOT).filter(shouldProcess);
let changed = 0;
for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  const after = apply(before);
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    changed++;
    console.log("updated:", path.relative(ROOT, file));
  }
}
console.log(`Done. ${changed} files updated.`);
