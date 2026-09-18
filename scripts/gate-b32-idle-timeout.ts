/**
 * B32 gate — 1h idle session timeout (static).
 * Usage: npm run gate:b32
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function log(msg: string) {
  console.log(`[gate-b32] ${msg}`);
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
  log("B32 idle session timeout gate");

  const hook = read("lib/auth/useIdleTimeout.ts");
  const provider = read("components/auth/IdleTimeoutProvider.tsx");
  const opLayout = read("app/operator/layout.tsx");
  const clientShell = read("components/platform/ClientShellFrame.tsx");
  const portalLogin = read("app/portal/login/page.tsx");
  const clientLogin = read("app/client/(auth)/login/page.tsx");
  const admin = read("lib/supabase/admin.ts");

  assert(hook.includes("IDLE_TIMEOUT_MS_DEFAULT = 3_600_000"), "default must be 1h (3600000)");
  assert(
    !/timeoutMs\s*=\s*\d{1,6}\b/.test(hook.replace("3_600_000", "")),
    "no shortened timeout default left in prod hook"
  );
  assert(hook.includes("pointerdown"), "pointerdown activity");
  assert(hook.includes("keydown"), "keydown activity");
  assert(hook.includes("scroll"), "scroll activity");
  assert(hook.includes("wheel"), "wheel activity");
  assert(hook.includes("touchstart"), "touchstart activity");
  assert(hook.includes("visibilitychange"), "visibilitychange");
  assert(hook.includes("localStorage"), "cross-tab last-active");
  assert(hook.includes("BroadcastChannel"), "logout broadcast");
  assert(hook.includes("signOut"), "signOut on idle");
  assert(hook.includes("getUser"), "focus getUser check");
  assert(
    hook.includes("evaluate expiry") || hook.includes("expiry check FIRST"),
    "visibility ordering comment/guard must be explicit"
  );
  assert(hook.includes("followLogoutBroadcast"), "cross-tab receivers must redirect");
  assert(hook.includes("router.replace"), "redirect on idle");
  assert(hook.includes("reason=idle"), "idle query param");
  assert(hook.includes("writeLastActive(Date.now())"), "mount must stamp lastActive");
  assert(
    !/if\s*\(\s*!window\.localStorage\.getItem\(LAST_ACTIVE_KEY\)\s*\)/.test(hook),
    "must not skip stamp when stale last-active key exists (re-login bounce)"
  );
  pass(1, "useIdleTimeout: 1h default, activity, cross-tab, visibility-before-activity", "hook");

  assert(provider.includes("useIdleTimeout"), "provider mounts hook");
  assert(provider.includes('"use client"'), "provider is client");
  pass(2, "IdleTimeoutProvider wrapper", "server-layout safe");

  assert(opLayout.includes("IdleTimeoutProvider"), "operator layout mounts provider");
  assert(opLayout.includes("PORTAL_LOGIN"), "operator uses PORTAL_LOGIN");
  assert(clientShell.includes("useIdleTimeout"), "client shell mounts hook");
  assert(clientShell.includes("CLIENT_LOGIN"), "client uses CLIENT_LOGIN");
  pass(3, "Mounted in operator layout + ClientShellFrame", "correct login URLs");

  assert(!portalLogin.includes("useIdleTimeout"), "portal login must not mount idle");
  assert(!portalLogin.includes("IdleTimeoutProvider"), "portal login must not mount provider");
  assert(!clientLogin.includes("useIdleTimeout"), "client login must not mount idle");
  assert(!clientLogin.includes("IdleTimeoutProvider"), "client login must not mount provider");
  pass(4, "Login pages do not mount idle hook", "public auth clean");

  assert(
    admin.includes("persistSession: false") || admin.includes("persistSession:false"),
    "admin client still persistSession:false"
  );
  assert(!admin.includes("useIdleTimeout"), "admin untouched by idle hook");
  pass(5, "Admin / MCP path untouched", "persistSession:false intact");

  log("Done — static checks passed");
}

main();
