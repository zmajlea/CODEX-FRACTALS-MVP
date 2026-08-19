import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerMcpTools } from "@/lib/mcp/register-tools";
import { verifyMcpToken } from "@/lib/mcp/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    registerMcpTools(server);
  },
  {
    serverInfo: { name: "summit-treasury-mcp", version: "1.0.0" },
  }
);

const authHandler = withMcpAuth(handler, verifyMcpToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authHandler as GET, authHandler as POST };
