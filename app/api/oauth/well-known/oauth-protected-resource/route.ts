import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandler,
} from "mcp-handler";
import { mcpResourceUrl, oauthIssuer } from "@/lib/mcp/oauth-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProtectedResourceHandler = ReturnType<typeof protectedResourceHandler>;

let handler: ProtectedResourceHandler | undefined;

function getHandler(): ProtectedResourceHandler {
  if (!handler) {
    handler = protectedResourceHandler({
      authServerUrls: [oauthIssuer()],
      resourceUrl: mcpResourceUrl(),
    });
  }
  return handler;
}

export async function GET(req: Request) {
  return getHandler()(req);
}

export async function OPTIONS() {
  return metadataCorsOptionsRequestHandler()();
}
