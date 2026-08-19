import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  checkOAuthRateLimit,
  clientIp,
  oauthErrorResponse,
} from "@/lib/mcp/oauth-http";
import {
  type RegisterClientInput,
  registerOAuthClient,
} from "@/lib/mcp/oauth-clients";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = createSupabaseAdminClient();
  const ip = clientIp(req);
  const limited = await checkOAuthRateLimit(admin, "oauth/register", ip);
  if (!limited.ok) {
    return oauthErrorResponse("slow_down", "Rate limit exceeded", 429);
  }

  let body: RegisterClientInput;
  try {
    body = (await req.json()) as RegisterClientInput;
  } catch {
    return oauthErrorResponse("invalid_request", "Invalid JSON");
  }

  const result = await registerOAuthClient(admin, body);
  if (!result.ok) {
    return oauthErrorResponse("invalid_client_metadata", result.error);
  }

  return Response.json(
    {
      client_id: result.client_id,
      ...(result.client_secret ? { client_secret: result.client_secret } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: body.token_endpoint_auth_method ?? "none",
      grant_types: body.grant_types ?? ["authorization_code", "refresh_token"],
      redirect_uris: body.redirect_uris,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
