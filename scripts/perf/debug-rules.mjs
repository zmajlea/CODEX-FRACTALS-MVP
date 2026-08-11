import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  let k = t.slice(0, eq).trim(),
    v = t.slice(eq + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  }
);
const cid = "6d53f194-e71b-4965-aecc-eab9f81ed311";
console.log(
  await admin.from("treasury_rules").select("id,match_merchant,assign_label").eq("client_user_id", cid)
);
console.log(await admin.from("treasury_rules").select("id").eq("client_user_id", cid));
console.log(
  await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", cid)
);
