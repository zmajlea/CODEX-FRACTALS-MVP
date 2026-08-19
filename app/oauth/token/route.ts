import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  checkOAuthRateLimit,
  clientIp,
  oauthErrorResponse,
} from "@/lib/mcp/oauth-http";
import {
  exchangeAuthorizationCode,
  exchangeRefreshToken,
} from "@/lib/mcp/oauth-tokens";

export const runtime = "nodejs";

async function parseBody(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await req.json()) as Record<string, string>;
    return j;
  }
  const fd = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export async function POST(req: Request) {
  const admin = createSupabaseAdminClient();
  const ip = clientIp(req);
  const limited = await checkOAuthRateLimit(admin, "oauth/token", ip);
  if (!limited.ok) {
    return oauthErrorResponse("slow_down", "Rate limit exceeded", 429);
  }

  let body: Record<string, string>;
  try {
    body = await parseBody(req);
  } catch {
    return oauthErrorResponse("invalid_request", "Invalid body");
  }

  const grantType = body.grant_type;

  if (grantType === "authorization_code") {
    const code = body.code;
    const redirectUri = body.redirect_uri;
    const clientId = body.client_id;
    const codeVerifier = body.code_verifier;
    if (!code || !redirectUri || !clientId || !codeVerifier) {
      return oauthErrorResponse("invalid_request", "Missing parameters");
    }
    const out = await exchangeAuthorizationCode(admin, {
      code,
      clientId,
      redirectUri,
      codeVerifier,
    });
    if (!out.ok) {
      return oauthErrorResponse(out.error, "Authorization code invalid");
    }
    return Response.json(out, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (grantType === "refresh_token") {
    const refresh = body.refresh_token;
    if (!refresh) {
      return oauthErrorResponse("invalid_request", "refresh_token required");
    }
    const out = await exchangeRefreshToken(admin, refresh);
    if (!out.ok) {
      return oauthErrorResponse(out.error, "Refresh token invalid");
    }
    return Response.json(out, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  return oauthErrorResponse("unsupported_grant_type", grantType ?? "missing");
}
