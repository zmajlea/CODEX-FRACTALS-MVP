/** Spec B2 — OAuth AS/RS configuration from env. */

export const MCP_OAUTH_SCOPES = ["treasury:read", "treasury:write"] as const;
export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

export const CLAUDE_MCP_REDIRECT =
  "https://claude.ai/api/mcp/auth_callback";

export function oauthIssuer(): string {
  const issuer = process.env.MCP_OAUTH_ISSUER?.trim();
  if (!issuer) {
    throw new Error("MCP_OAUTH_ISSUER is not configured");
  }
  return issuer.replace(/\/$/, "");
}

export function mcpResourceUrl(): string {
  const explicit = process.env.MCP_RESOURCE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return `${oauthIssuer()}/api/mcp`;
}

export function oauthSigningSecret(): string {
  const secret = process.env.MCP_OAUTH_SIGNING_SECRET?.trim();
  if (!secret) {
    throw new Error("MCP_OAUTH_SIGNING_SECRET is not configured");
  }
  return secret;
}

export function oauthAccessTtlSec(): number {
  const n = Number(process.env.MCP_OAUTH_ACCESS_TTL_SEC ?? "3600");
  return Number.isFinite(n) && n > 0 ? n : 3600;
}

export function oauthRefreshTtlSec(): number {
  const n = Number(process.env.MCP_OAUTH_REFRESH_TTL_SEC ?? "2592000");
  return Number.isFinite(n) && n > 0 ? n : 2592000;
}

export function oauthAuthCodeTtlSec(): number {
  return 300;
}

/** RFC 8414 paths (also rewritten from /.well-known/* in next.config). */
export const OAUTH_WELLKNOWN_PROTECTED_RESOURCE =
  "/api/oauth/well-known/oauth-protected-resource";
export const OAUTH_WELLKNOWN_AUTHORIZATION_SERVER =
  "/api/oauth/well-known/oauth-authorization-server";

export function oauthAuthorizeUrl(issuer = oauthIssuer()): string {
  return `${issuer}/oauth/authorize`;
}

export function oauthTokenUrl(issuer = oauthIssuer()): string {
  return `${issuer}/oauth/token`;
}

export function oauthRegisterUrl(issuer = oauthIssuer()): string {
  return `${issuer}/oauth/register`;
}

export function isRedirectUriAllowed(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (uri === CLAUDE_MCP_REDIRECT) return true;
    if (u.protocol === "http:" && u.hostname === "localhost") return true;
    if (u.protocol === "http:" && u.hostname === "127.0.0.1") return true;
    return false;
  } catch {
    return false;
  }
}

export function parseScopeString(scope: string | null | undefined): McpOAuthScope[] {
  if (!scope?.trim()) return [...MCP_OAUTH_SCOPES];
  const parts = scope.trim().split(/\s+/);
  const valid = parts.filter((s): s is McpOAuthScope =>
    MCP_OAUTH_SCOPES.includes(s as McpOAuthScope)
  );
  return valid.length ? valid : [...MCP_OAUTH_SCOPES];
}

export function scopeIncludes(
  granted: string[],
  required: McpOAuthScope
): boolean {
  return granted.includes(required);
}
