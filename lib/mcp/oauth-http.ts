import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Admin = SupabaseClient<Database>;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

export async function checkOAuthRateLimit(
  admin: Admin,
  route: string,
  ip: string | null
): Promise<{ ok: true } | { ok: false }> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count, error } = await admin
    .from("oauth_rate_log")
    .select("id", { count: "exact", head: true })
    .eq("route", route)
    .eq("ip", ip ?? "unknown")
    .gte("created_at", since);

  if (error) return { ok: true };
  if ((count ?? 0) >= MAX_PER_WINDOW) return { ok: false };

  void admin.from("oauth_rate_log").insert({
    route,
    ip: ip ?? "unknown",
  });

  return { ok: true };
}

export function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

export function oauthErrorResponse(
  error: string,
  description?: string,
  status = 400
): Response {
  return Response.json(
    { error, error_description: description ?? error },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}
