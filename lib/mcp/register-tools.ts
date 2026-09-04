import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeMcpAudit } from "@/lib/mcp/audit";
import { requireMcpClientGrant } from "@/lib/mcp/grant";
import {
  DESCRIBE_WORKFLOW,
  mcpGetCashModelBaseline,
  mcpGetClient,
  mcpGetMonthlyByCategory,
  mcpGetRecommendations,
  mcpGetReview,
  mcpGetRules,
  mcpGetStudies,
  mcpGetTransactions,
  mcpListClients,
} from "@/lib/mcp/read-tools";
import { mcpProposeRecommendation, mcpProposeRule, mcpSubmitResults, mcpDefineMetric, mcpProposeNarrative } from "@/lib/mcp/write-tools";
import {
  mcpComputeMetric,
  mcpGetMetric,
  mcpListMetrics,
  mcpPreviewMetric,
} from "@/lib/mcp/metric-tools";
import {
  authContextFromInfo,
  mcpError,
  mcpText,
  requireMcpScope,
  type McpToolContext,
} from "@/lib/mcp/types";

function httpRequest(sdkCtx: { http?: { req?: Request; authInfo?: unknown } }): Request {
  return sdkCtx.http?.req ?? new Request("http://local");
}

function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

async function withTool<T>(
  ctx: McpToolContext,
  tool: string,
  clientId: string | null,
  fn: () => Promise<T>
): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> {
  try {
    const out = await fn();
    void writeMcpAudit(ctx.admin, {
      operatorUserId: ctx.auth.operatorUserId,
      tenantId: ctx.auth.tenantId,
      tool,
      clientId,
      ok: true,
      ip: ctx.ip,
    });
    return mcpText(out);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    void writeMcpAudit(ctx.admin, {
      operatorUserId: ctx.auth.operatorUserId,
      tenantId: ctx.auth.tenantId,
      tool,
      clientId,
      ok: false,
      error: message,
      ip: ctx.ip,
    });
    return mcpError(message);
  }
}

async function requireClient(
  ctx: McpToolContext,
  clientId: string
): Promise<{ ok: true } | ReturnType<typeof mcpError>> {
  const grant = await requireMcpClientGrant(ctx.admin, ctx.auth, clientId);
  if (!grant.ok) return mcpError(grant.message);
  return { ok: true };
}

export function registerMcpTools(server: McpServer) {
  server.registerTool(
    "describe_workflow",
    {
      title: "Describe workflow",
      description: "How to use Summit Treasury MCP tools and submit_results.",
      inputSchema: z.object({}),
    },
    async (_args, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      return withTool(ctx, "describe_workflow", null, async () => ({
        workflow: DESCRIBE_WORKFLOW,
      }));
    }
  );

  server.registerTool(
    "list_clients",
    {
      title: "List clients",
      description:
        "Operator's granted treasury clients (id, name, data_through, to_review).",
      inputSchema: z.object({}),
    },
    async (_args, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      return withTool(ctx, "list_clients", null, () =>
        mcpListClients(ctx.admin, ctx.auth)
      );
    }
  );

  const clientIdSchema = z.object({
    client_id: z.string().uuid(),
  });

  server.registerTool(
    "get_client",
    {
      title: "Get client",
      description:
        "Accounts (masked), categories, rules summary, recommendations, data_through, opening balance.",
      inputSchema: clientIdSchema,
    },
    async ({ client_id }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "get_client", client_id, () =>
        mcpGetClient(ctx.admin, ctx.auth, client_id)
      );
    }
  );

  server.registerTool(
    "get_transactions",
    {
      title: "Get transactions",
      description:
        "Categorized ledger rows. Sign convention: positive = money in, negative = money out.",
      inputSchema: clientIdSchema.extend({
        from: z.string().optional(),
        to: z.string().optional(),
        status: z.enum(["labeled", "needs_label", "all"]).optional(),
      }),
    },
    async ({ client_id, from, to, status }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "get_transactions", client_id, () =>
        mcpGetTransactions(ctx.admin, client_id, {
          from,
          to,
          status: status === "all" || !status ? undefined : status,
        })
      );
    }
  );

  server.registerTool(
    "get_monthly_by_category",
    {
      title: "Monthly by category",
      description: "month, category, inflow, outflow, net aggregates from our ledger.",
      inputSchema: clientIdSchema,
    },
    async ({ client_id }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "get_monthly_by_category", client_id, () =>
        mcpGetMonthlyByCategory(ctx.admin, client_id)
      );
    }
  );

  server.registerTool(
    "get_rules",
    {
      title: "Get rules",
      description: "Full rule set for the client.",
      inputSchema: clientIdSchema,
    },
    async ({ client_id }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "get_rules", client_id, () =>
        mcpGetRules(ctx.admin, client_id)
      );
    }
  );

  server.registerTool(
    "get_recommendations",
    {
      title: "Get recommendations",
      description: "Existing recommendations and statuses.",
      inputSchema: clientIdSchema,
    },
    async ({ client_id }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "get_recommendations", client_id, () =>
        mcpGetRecommendations(ctx.admin, client_id)
      );
    }
  );

  server.registerTool(
    "get_cash_model_baseline",
    {
      title: "Cash model baseline",
      description:
        "Our engine Base-case summary for silent verifier comparison.",
      inputSchema: clientIdSchema,
    },
    async ({ client_id }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "get_cash_model_baseline", client_id, () =>
        mcpGetCashModelBaseline(ctx.admin, client_id)
      );
    }
  );

  server.registerTool(
    "submit_results",
    {
      title: "Submit results",
      description:
        "Validate and store summit.results/v1 as a pending external study.",
      inputSchema: clientIdSchema.extend({
        results: z.record(z.string(), z.unknown()),
      }),
    },
    async ({ client_id, results }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:write");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "submit_results", client_id, async () => {
        const out = await mcpSubmitResults(
          ctx.admin,
          ctx.auth,
          client_id,
          results
        );
        if (!out.ok) {
          throw new Error(
            `Validation failed: ${JSON.stringify(out.report, null, 2)}`
          );
        }
        return {
          study_id: out.studyId,
          validation: out.report,
          message:
            "Pending operator confirmation in the app — not auto-published.",
        };
      });
    }
  );

  server.registerTool(
    "propose_recommendation",
    {
      title: "Propose recommendation",
      description: "Create a draft recommendation (never auto-sent).",
      inputSchema: clientIdSchema.extend({
        kind: z.string().optional(),
        title: z.string().min(1),
        body: z.string().min(1),
        category: z.string().optional(),
      }),
    },
    async ({ client_id, kind, title, body, category }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:write");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "propose_recommendation", client_id, () =>
        mcpProposeRecommendation(ctx.admin, ctx.auth, client_id, {
          kind,
          title,
          body,
          category,
        })
      );
    }
  );

  server.registerTool(
    "propose_rule",
    {
      title: "Propose rule",
      description:
        "Propose a categorization rule (pending — not applied until operator confirms).",
      inputSchema: clientIdSchema.extend({
        name: z.string().min(1),
        payee_contains: z.string().min(1),
        category: z.string().min(1),
        direction: z.enum(["in", "out"]).optional(),
        min_amount: z.number().optional(),
        max_amount: z.number().optional(),
      }),
    },
    async (
      { client_id, name, payee_contains, category, direction, min_amount, max_amount },
      sdkCtx
    ) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:write");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "propose_rule", client_id, () =>
        mcpProposeRule(ctx.admin, ctx.auth, client_id, {
          name,
          payee_contains,
          category,
          direction,
          min_amount,
          max_amount,
        })
      );
    }
  );

  server.registerTool(
    "list_metrics",
    {
      title: "List metrics",
      description: "List client + global metrics for the operator tenant.",
      inputSchema: z.object({
        client_id: z.string().uuid().optional(),
      }),
    },
    async ({ client_id }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      if (client_id) {
        const denied = await requireClient(ctx, client_id);
        if ("isError" in denied) return denied;
      }
      return withTool(ctx, "list_metrics", client_id ?? null, () =>
        mcpListMetrics(ctx.admin, ctx.auth, client_id)
      );
    }
  );

  server.registerTool(
    "get_metric",
    {
      title: "Get metric",
      description: "Get a metric definition and cached value.",
      inputSchema: z.object({ id: z.string().uuid() }),
    },
    async ({ id }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      return withTool(ctx, "get_metric", null, () =>
        mcpGetMetric(ctx.admin, ctx.auth, id)
      );
    }
  );

  server.registerTool(
    "compute_metric",
    {
      title: "Compute metric",
      description: "Evaluate a metric against the ledger (read-only).",
      inputSchema: z.object({
        id: z.string().uuid(),
        client_id: z.string().uuid().optional(),
      }),
    },
    async ({ id, client_id }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      if (client_id) {
        const denied = await requireClient(ctx, client_id);
        if ("isError" in denied) return denied;
      }
      return withTool(ctx, "compute_metric", client_id ?? null, () =>
        mcpComputeMetric(ctx.admin, ctx.auth, id, client_id)
      );
    }
  );

  server.registerTool(
    "define_metric",
    {
      title: "Define metric",
      description:
        "Define a declarative metric (whitelisted grammar only — no SQL).",
      inputSchema: z.object({
        scope: z.enum(["general", "client"]),
        name: z.string().min(1),
        description: z.string().optional().default(""),
        definition: z.record(z.string(), z.unknown()),
        client_id: z.string().uuid().optional(),
      }),
    },
    async ({ scope, name, description, definition, client_id }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:write");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      if (client_id) {
        const denied = await requireClient(ctx, client_id);
        if ("isError" in denied) return denied;
      }
      return withTool(ctx, "define_metric", client_id ?? null, () =>
        mcpDefineMetric(ctx.admin, ctx.auth, {
          scope,
          name,
          description: description ?? "",
          definition,
          clientId: client_id,
        })
      );
    }
  );

  server.registerTool(
    "get_studies",
    {
      title: "Get studies",
      description:
        "List a client's studies (cash_model + external_model) with status, KPIs, and as_of (Spec B16).",
      inputSchema: clientIdSchema,
    },
    async ({ client_id }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "get_studies", client_id, () =>
        mcpGetStudies(ctx.admin, ctx.auth, client_id)
      );
    }
  );

  server.registerTool(
    "get_review",
    {
      title: "Get review",
      description:
        "Read draft review blocks (including study blocks) with envelope aggregates and suggested captions (Spec B12/B16).",
      inputSchema: clientIdSchema.extend({
        review_id: z.string().uuid().optional(),
        refresh: z.boolean().optional(),
      }),
    },
    async ({ client_id, review_id, refresh }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "get_review", client_id, () =>
        mcpGetReview(ctx.admin, ctx.auth, client_id, review_id, refresh)
      );
    }
  );

  server.registerTool(
    "preview_metric",
    {
      title: "Preview metric",
      description: "Evaluate a metric grammar without persisting (read-only).",
      inputSchema: clientIdSchema.extend({
        definition: z.record(z.string(), z.unknown()),
      }),
    },
    async ({ client_id, definition }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:read");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "preview_metric", client_id, () =>
        mcpPreviewMetric(ctx.admin, ctx.auth, client_id, definition)
      );
    }
  );

  server.registerTool(
    "propose_narrative",
    {
      title: "Propose narrative",
      description:
        "Attach PROPOSED caption/note/narrative to a draft review (Spec B12).",
      inputSchema: clientIdSchema.extend({
        review_id: z.string().uuid(),
        target: z.object({
          kind: z.enum(["exhibit_caption", "figure_caption", "note", "narrative"]),
          metric_id: z.string().uuid().optional(),
          position: z.number().int().optional(),
        }),
        text: z.string().min(1),
        title: z.string().optional(),
        rec_kind: z.enum(["recommendation", "question"]).optional(),
      }),
    },
    async ({ client_id, review_id, target, text, title, rec_kind }, sdkCtx) => {
      const auth = authContextFromInfo(sdkCtx.http?.authInfo);
      if (!auth) return mcpError("Unauthorized");
      const scopeErr = requireMcpScope(auth, "treasury:write");
      if (scopeErr) return scopeErr;
      const ctx: McpToolContext = {
        auth,
        admin: createSupabaseAdminClient(),
        request: httpRequest(sdkCtx),
        ip: clientIp(httpRequest(sdkCtx)),
      };
      const denied = await requireClient(ctx, client_id);
      if ("isError" in denied) return denied;
      return withTool(ctx, "propose_narrative", client_id, () =>
        mcpProposeNarrative(ctx.admin, ctx.auth, client_id, {
          review_id,
          target,
          text,
          title,
          rec_kind,
        })
      );
    }
  );
}
