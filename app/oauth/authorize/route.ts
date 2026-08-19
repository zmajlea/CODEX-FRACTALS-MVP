import { NextResponse } from "next/server";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { getPrimaryOperatorTenantId, getTier } from "@/lib/auth/rbac";
import {
  clientAllowsRedirect,
  getOAuthClient,
} from "@/lib/mcp/oauth-clients";
import { parseScopeString } from "@/lib/mcp/oauth-config";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function requireParam(url: URL, key: string): string | null {
  const v = url.searchParams.get(key);
  return v?.trim() ? v.trim() : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const responseType = requireParam(url, "response_type");
  const clientId = requireParam(url, "client_id");
  const redirectUri = requireParam(url, "redirect_uri");
  const state = requireParam(url, "state");
  const codeChallenge = requireParam(url, "code_challenge");
  const codeChallengeMethod = requireParam(url, "code_challenge_method") ?? "S256";
  const scope = url.searchParams.get("scope");

  if (responseType !== "code") {
    return NextResponse.json({ error: "unsupported_response_type" }, { status: 400 });
  }
  if (!clientId || !redirectUri || !state || !codeChallenge) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (codeChallengeMethod !== "S256") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();
  const client = await getOAuthClient(admin, clientId);
  if (!client || !clientAllowsRedirect(client, redirectUri)) {
    return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const authorizeReturn = url.pathname + url.search;

  if (!user) {
    const login = `${PORTAL_LOGIN}?next=${encodeURIComponent(authorizeReturn)}`;
    return NextResponse.redirect(new URL(login, url.origin));
  }

  const tier = await getTier(supabase, user.id);
  if (tier !== "operator" && tier !== "global_admin") {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }

  const tenantId = await getPrimaryOperatorTenantId(supabase, user.id);
  if (!tenantId) {
    return NextResponse.json(
      { error: "access_denied", error_description: "No operator tenant" },
      { status: 403 }
    );
  }

  parseScopeString(scope ?? undefined);

  const consent = new URL("/oauth/consent", url.origin);
  consent.searchParams.set("client_id", clientId);
  consent.searchParams.set("redirect_uri", redirectUri);
  consent.searchParams.set("state", state);
  consent.searchParams.set("code_challenge", codeChallenge);
  consent.searchParams.set("code_challenge_method", codeChallengeMethod);
  if (scope) consent.searchParams.set("scope", scope);
  consent.searchParams.set("client_name", client.client_name ?? clientId);

  return NextResponse.redirect(consent);
}
