import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPS = [
  ["FF_SECTIONS", "BCN_SECTIONS"],
  ["FF_HUB_GROUPS", "BCN_HUB_GROUPS"],
  ["FF_ICONS", "BCN_ICONS"],
  ["FfSectionPayload", "BcnSectionPayload"],
  ["FfSectionDef", "BcnSectionDef"],
  ["FfWizardState", "BcnWizardState"],
  ["FfContactRow", "BcnContactRow"],
  ["FfLabeledFields", "BcnLabeledFields"],
  ["FfRoleBlock", "BcnRoleBlock"],
  ["FfCommercialRole", "BcnCommercialRole"],
  ["FfLoginRoute", "BcnLoginRoute"],
  ["FfSealMark", "BcnSealMark"],
  ["FfSolutionMark", "BcnSolutionMark"],
  ["fetchFfLoginRoute", "fetchBcnLoginRoute"],
  ["ClientFfPage", "ClientBcnPage"],
  ["ff1:", "bcn1:"],
  ["ff2:", "bcn2:"],
  ["ff3:", "bcn3:"],
  ["ff4:", "bcn4:"],
  ["ff1–ff3", "bcn1–bcn3"],
  ["ff1, ff2, or ff3", "bcn1, bcn2, or bcn3"],
  ['"ff3"', '"bcn3"'],
  ["'ff3'", "'bcn3'"],
  ["distributorTenants", "operatorTenants"],
  ["BcnContinuityShellMode", "BcnContinuityShellMode"],
];

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else files.push(p);
  }
  return files;
}

for (const file of walk(ROOT)) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  if (file.includes("IA_CONTEXT")) continue;
  let c = fs.readFileSync(file, "utf8");
  let n = c;
  for (const [a, b] of REPS) n = n.split(a).join(b);
  if (n !== c) {
    fs.writeFileSync(file, n);
    console.log(path.relative(ROOT, file));
  }
}
