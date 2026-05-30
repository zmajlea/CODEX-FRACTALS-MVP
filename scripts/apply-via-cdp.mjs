import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exprDir = path.join(__dirname, "cdp-expr");

function stripChunkMarker(line) {
  return line.replace(/;\s*'chunk\d+'\s*$/s, "").trimEnd();
}

function buildCdpAll() {
  const parts = ["window.__b64='';", ""];
  for (let i = 0; i <= 4; i++) {
    const file = path.join(exprDir, `${i}.txt`);
    const raw = fs.readFileSync(file, "utf8").trimEnd();
    const stmt = stripChunkMarker(raw);
    parts.push(`// chunk ${i}`);
    parts.push(stmt);
    parts.push("");
  }
  const inject = fs.readFileSync(path.join(exprDir, "inject.txt"), "utf8").trimEnd();
  parts.push("// inject");
  parts.push(inject);
  parts.push("");
  const out = path.join(__dirname, "cdp-all.js");
  fs.writeFileSync(out, parts.join("\n"), "utf8");
  return fs.statSync(out).size;
}

function escapeJsString(s) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r/g, "").replace(/\n/g, "\\n");
}

function buildCdpAllInOne() {
  const chunks = [];
  let i = 0;
  while (fs.existsSync(path.join(__dirname, `mig-chunk-${i}.txt`))) {
    chunks.push(fs.readFileSync(path.join(__dirname, `mig-chunk-${i}.txt`), "utf8").trim());
    i++;
  }
  const chunkLiterals = chunks.map((c) => `'${escapeJsString(c)}'`).join(",\n    ");
  const body = `(() => {
  const sql = atob(window.__b64);
  const ed = window.monaco?.editor?.getEditors?.()?.[0];
  if (!ed) return { ok: false, err: 'no monaco' };
  ed.setValue(sql);
  return { ok: true, len: sql.length, head: sql.slice(0, 50) };
})()`;
  const src = `(function () {
  var CHUNKS = [
    ${chunkLiterals}
  ];
  window.__b64 = CHUNKS.join('');
${body}
})();\n`;
  const out = path.join(__dirname, "cdp-all-in-one.js");
  fs.writeFileSync(out, src, "utf8");
  return fs.statSync(out).size;
}

const allSize = buildCdpAll();
const inOneSize = buildCdpAllInOne();
console.log(`cdp-all.js: ${allSize} bytes`);
console.log(`cdp-all-in-one.js: ${inOneSize} bytes`);
