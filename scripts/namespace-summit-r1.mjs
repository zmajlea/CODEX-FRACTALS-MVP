/**
 * One-shot generator: Ana's summit-r1.css → [data-r1]-scoped app/styles/summit-r1.css
 * Run: node scripts/namespace-summit-r1.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(
  __dirname,
  "../../CODEXONE/Summit_R1_UX-UI_v1.0/html/assets/summit-r1.css"
);
const OUT = resolve(__dirname, "../app/styles/summit-r1.css");

const HEADER = `/* GENERATED from Summit_R1_UX-UI_v1.0/html/assets/summit-r1.css (Ana / Vera, 19 Jul 2026).
   Every rule is scoped to [data-r1]. Do not hand-edit: regenerate with
   scripts/namespace-summit-r1.mjs. A needed shade is a new token in the
   [data-brand] block, never a literal hex in a component. */
`;

const SKIP = /^(\[data-brand)/;

function scopeSelectorList(selectorList) {
  return selectorList
    .split(",")
    .map((raw) => {
      const s = raw.trim();
      if (!s || SKIP.test(s)) return raw.trimEnd() === raw ? s : raw;
      // Spec 47 Gate 4 — :root role tokens must not clobber Continuity fonts.
      if (s === ":root") return "[data-r1]";
      if (s === "*") return "[data-r1] *";
      if (/^(html|body)\b/.test(s)) return "[data-r1]";
      return `[data-r1] ${s}`;
    })
    .join(", ");
}

function findMatchingClose(css, openBrace) {
  let depth = 0;
  for (let i = openBrace; i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("Unbalanced braces");
}

function transformBlock(css, start = 0, end = css.length) {
  let i = start;
  let result = "";

  while (i < end) {
    if (css.slice(i, i + 2) === "/*") {
      const endComment = css.indexOf("*/", i) + 2;
      result += css.slice(i, endComment);
      i = endComment;
      continue;
    }

    const ws = css.slice(i, end).match(/^\s+/);
    if (ws) {
      result += ws[0];
      i += ws[0].length;
      continue;
    }

    if (css[i] === "@") {
      const brace = css.indexOf("{", i);
      if (brace === -1 || brace >= end) break;
      const prelude = css.slice(i, brace + 1);
      const close = findMatchingClose(css, brace);

      if (/^@keyframes\b/i.test(prelude)) {
        result += css.slice(i, close + 1);
      } else if (/^@media\b/i.test(prelude)) {
        result +=
          prelude + transformBlock(css, brace + 1, close) + css[close];
      } else {
        result += css.slice(i, close + 1);
      }
      i = close + 1;
      continue;
    }

    const brace = css.indexOf("{", i);
    if (brace === -1 || brace >= end) {
      result += css.slice(i, end);
      break;
    }

    const selectors = css.slice(i, brace);
    const close = findMatchingClose(css, brace);
    const scoped = scopeSelectorList(selectors.replace(/\s+$/g, ""));
    result += scoped + css.slice(brace, close + 1);
    i = close + 1;
  }

  return result;
}

const src = readFileSync(SRC, "utf8");
const body = transformBlock(src);
writeFileSync(OUT, `${HEADER}\n${body}`);
const lines = (HEADER + "\n" + body).split("\n").length;
console.log(`Wrote ${OUT} (${lines} lines)`);
