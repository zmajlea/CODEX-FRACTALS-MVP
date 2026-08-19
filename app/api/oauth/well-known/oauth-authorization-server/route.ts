import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import {
  MCP_OAUTH_SCOPES,
  oauthAuthorizeUrl,
  oauthIssuer,
  oauthRegisterUrl,
  oauthTokenUrl,
} from "@/lib/mcp/oauth-config";

export const runtime = "nodejs";

export async function GET() {
  const issuer = oauthIssuer();
  const metadata = {
    issuer,
    authorization_endpoint: oauthAuthorizeUrl(issuer),
    token_endpoint: oauthTokenUrl(issuer),
    registration_endpoint: oauthRegisterUrl(issuer),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post",
    ],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    // CIMD seam — not supported in B2
    client_id_metadata_document_supported: false,
  };
  return Response.json(metadata, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function OPTIONS() {
  return metadataCorsOptionsRequestHandler()();
}
