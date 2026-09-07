/**
 * Run gate-review-b12 with server-only stubbed (CLI is not a Next server).
 * Usage: node scripts/run-gate-review.cjs
 */
const path = require("path");
const { spawnSync } = require("child_process");

const stub = path.join(__dirname, "stub-server-only.cjs");
const script = path.join(__dirname, "gate-review-b12.ts");
const prior = process.env.NODE_OPTIONS?.trim() ?? "";
const nodeOptions = prior.includes("stub-server-only")
  ? prior
  : [`--require ${stub}`, prior].filter(Boolean).join(" ");

const r = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", script],
  {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    shell: true,
  }
);

process.exit(r.status ?? 1);
