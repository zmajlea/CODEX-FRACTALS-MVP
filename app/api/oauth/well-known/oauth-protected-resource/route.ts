import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandler,
} from "mcp-handler";
import { mcpResourceUrl, oauthIssuer } from "@/lib/mcp/oauth-config";

export const runtime = "nodejs";

const handler = protectedResourceHandler({
  authServerUrls: [oauthIssuer()],
  resourceUrl: mcpResourceUrl(),
});

export async function GET(req: Request) {
  return handler(req);
}

export async function OPTIONS() {
  return metadataCorsOptionsRequestHandler()();
}
