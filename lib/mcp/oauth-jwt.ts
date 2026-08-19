import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
import {
  mcpResourceUrl,
  oauthAccessTtlSec,
  oauthIssuer,
  oauthSigningSecret,
  type McpOAuthScope,
} from "@/lib/mcp/oauth-config";

export type AccessTokenClaims = {
  sub: string;
  tenant_id: string;
  scope: string;
  jti: string;
};

export async function mintAccessToken(params: {
  operatorUserId: string;
  tenantId: string;
  scopes: McpOAuthScope[];
}): Promise<{ token: string; jti: string; expiresAt: number }> {
  const jti = randomUUID();
  const ttl = oauthAccessTtlSec();
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const secret = new TextEncoder().encode(oauthSigningSecret());
  const token = await new SignJWT({
    tenant_id: params.tenantId,
    scope: params.scopes.join(" "),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(params.operatorUserId)
    .setJti(jti)
    .setIssuer(oauthIssuer())
    .setAudience(mcpResourceUrl())
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret);

  return { token, jti, expiresAt };
}

export async function verifyAccessToken(
  bearer: string
): Promise<
  | {
      operatorUserId: string;
      tenantId: string;
      scopes: string[];
      jti: string;
      expiresAt: number;
    }
  | null
> {
  if (!bearer.startsWith("eyJ")) return null;
  try {
    const secret = new TextEncoder().encode(oauthSigningSecret());
    const { payload } = await jwtVerify(bearer, secret, {
      issuer: oauthIssuer(),
      audience: mcpResourceUrl(),
    });
    const sub = payload.sub;
    const tenantId = payload.tenant_id as string | undefined;
    const scope = (payload.scope as string | undefined) ?? "";
    const jti = payload.jti;
    if (!sub || !tenantId || !jti) return null;
    return {
      operatorUserId: sub,
      tenantId,
      scopes: scope.split(/\s+/).filter(Boolean),
      jti: String(jti),
      expiresAt: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}
