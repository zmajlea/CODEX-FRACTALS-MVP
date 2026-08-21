import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isRedirectUriAllowed } from "@/lib/mcp/oauth-config";

type Admin = SupabaseClient<Database>;

export function hashOAuthSecret(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateClientId(): string {
  return `mcpoc_${randomBytes(16).toString("base64url")}`;
}

export function generateClientSecret(): string {
  return randomBytes(32).toString("base64url");
}

export type RegisterClientInput = {
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
  grant_types?: string[];
};

export async function registerOAuthClient(
  admin: Admin,
  input: RegisterClientInput
): Promise<
  | { ok: true; client_id: string; client_secret?: string }
  | { ok: false; error: string }
> {
  const redirectUris = input.redirect_uris ?? [];
  if (!redirectUris.length) {
    return { ok: false, error: "redirect_uris required" };
  }
  for (const uri of redirectUris) {
    if (!isRedirectUriAllowed(uri)) {
      return { ok: false, error: `redirect_uri not allowed: ${uri}` };
    }
  }

  const authMethod = input.token_endpoint_auth_method ?? "none";
  const clientId = generateClientId();
  let clientSecret: string | undefined;
  let secretHash: string | null = null;

  if (authMethod === "client_secret_basic" || authMethod === "client_secret_post") {
    clientSecret = generateClientSecret();
    secretHash = hashOAuthSecret(clientSecret);
  }

  const { error } = await admin.from("oauth_clients").insert({
    client_id: clientId,
    client_secret_hash: secretHash,
    client_name: input.client_name ?? null,
    redirect_uris: redirectUris,
    grant_types: input.grant_types ?? ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: authMethod,
  });

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  };
}

export async function getOAuthClient(admin: Admin, clientId: string) {
  const { data, error } = await admin
    .from("oauth_clients")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/**
 * Spec B9 — confidential clients must present client_secret (client_secret_post).
 * Public clients (token_endpoint_auth_method=none) need no secret.
 */
export async function assertClientAuth(
  admin: Admin,
  clientId: string,
  clientSecret: string | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = await getOAuthClient(admin, clientId);
  if (!client) {
    return { ok: false, error: "invalid_client" };
  }

  const method = client.token_endpoint_auth_method ?? "none";
  const needsSecret =
    method === "client_secret_post" || method === "client_secret_basic";

  if (!needsSecret) {
    return { ok: true };
  }

  if (!clientSecret || !client.client_secret_hash) {
    return { ok: false, error: "invalid_client" };
  }

  if (hashOAuthSecret(clientSecret) !== client.client_secret_hash) {
    return { ok: false, error: "invalid_client" };
  }

  return { ok: true };
}

export function clientAllowsRedirect(
  client: { redirect_uris: string[] },
  redirectUri: string
): boolean {
  return (
    client.redirect_uris.includes(redirectUri) &&
    isRedirectUriAllowed(redirectUri)
  );
}
