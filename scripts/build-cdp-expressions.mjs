import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "cdp-expr");
fs.mkdirSync(outDir, { recursive: true });

let chunkIndex = 0;
while (fs.existsSync(path.join(__dirname, `mig-chunk-${chunkIndex}.txt`))) {
  const chunk = fs.readFileSync(
    path.join(__dirname, `mig-chunk-${chunkIndex}.txt`),
    "utf8"
  );
  const escaped = chunk.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const expr =
    chunkIndex === 0
      ? `window.__b64='${escaped}'; 'chunk0'`
      : `window.__b64+='${escaped}'; 'chunk${chunkIndex}'`;
  fs.writeFileSync(path.join(outDir, `${chunkIndex}.txt`), expr);
  chunkIndex += 1;
}

const final = `(() => {
  const sql = atob(window.__b64);
  const ed = window.monaco?.editor?.getEditors?.()?.[0];
  if (!ed) return { ok: false, err: 'no monaco' };
  ed.setValue(sql);
  return { ok: true, len: sql.length, head: sql.slice(0, 50) };
})()`;
fs.writeFileSync(path.join(outDir, "inject.txt"), final);
fs.writeFileSync(path.join(outDir, "run.txt"), `(() => {
  const ed = window.monaco?.editor?.getEditors?.()?.[0];
  if (!ed) return 'no editor';
  ed.focus();
  return 'focused';
})()`);

console.log(`built ${chunkIndex} chunk expressions + inject + run`);
