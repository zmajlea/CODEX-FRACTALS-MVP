import { NextResponse } from "next/server";
import { getPrimaryOperatorTenantId, getTier } from "@/lib/auth/rbac";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  clientAllowsRedirect,
  getOAuthClient,
} from "@/lib/mcp/oauth-clients";
import { mintAuthorizationCode } from "@/lib/mcp/oauth-codes";
import { parseScopeString } from "@/lib/mcp/oauth-config";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

async function readForm(req: Request) {
  const fd = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export async function POST(req: Request) {
  const form = await readForm(req);
  const decision = form.decision;
  const clientId = form.client_id;
  const redirectUri = form.redirect_uri;
  const state = form.state;
  const codeChallenge = form.code_challenge;
  const codeChallengeMethod = form.code_challenge_method ?? "S256";
  const scopeRaw = form.scope;

  if (!clientId || !redirectUri || !state || !codeChallenge) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("state", state);

  if (decision === "deny") {
    redirect.searchParams.set("error", "access_denied");
    return NextResponse.redirect(redirect);
  }

  const admin = createSupabaseAdminClient();
  const client = await getOAuthClient(admin, clientId);
  if (!client || !clientAllowsRedirect(client, redirectUri)) {
    return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  }
  if (codeChallengeMethod !== "S256") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "access_denied" }, { status: 401 });
  }

  const tier = await getTier(supabase, user.id);
  if (tier !== "operator" && tier !== "global_admin") {
    redirect.searchParams.set("error", "access_denied");
    return NextResponse.redirect(redirect);
  }

  const tenantId = await getPrimaryOperatorTenantId(supabase, user.id);
  if (!tenantId) {
    redirect.searchParams.set("error", "access_denied");
    return NextResponse.redirect(redirect);
  }

  const scope = parseScopeString(scopeRaw).join(" ");
  const { code } = await mintAuthorizationCode(admin, {
    clientId,
    operatorUserId: user.id,
    tenantId,
    scope,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
  });

  redirect.searchParams.set("code", code);
  return NextResponse.redirect(redirect);
}
