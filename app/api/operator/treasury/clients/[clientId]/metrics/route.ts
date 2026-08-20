import { NextResponse } from "next/server";
import type { Json } from "@/lib/database.types";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { createMetric } from "@/lib/treasury/metrics-define";
import { computeMetricValue } from "@/lib/treasury/metrics-eval";

type RouteContext = { params: Promise<{ clientId: string }> };

/** Spec B4 — list (GET) + create (POST) metrics for a client. */
export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data, error } = await guard.admin
    .from("treasury_metrics")
    .select(
      "id, name, description, scope, source, status, computed_value, computed_at, definition, version, created_at, updated_at, client_user_id"
    )
    .eq("tenant_id", guard.grant.tenantId)
    .eq("status", "active")
    .or(`client_user_id.eq.${clientId},client_user_id.is.null`)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ metrics: data ?? [] });
}

export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: {
    scope?: "general" | "client";
    name?: string;
    description?: string;
    definition?: unknown;
    general?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scope: "general" | "client" =
    body.general === true || body.scope === "general" ? "general" : "client";
  const name = body.name?.trim() ?? "";
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (body.definition === undefined) {
    return NextResponse.json({ error: "definition required" }, { status: 400 });
  }

  try {
    const created = await createMetric(guard.admin, {
      tenantId: guard.grant.tenantId,
      operatorUserId: guard.user.id,
      scope,
      clientId: scope === "client" ? clientId : null,
      name,
      description: body.description ?? "",
      definition: body.definition,
      source: "platform",
    });

    let computed: { value: number; computed_at: string } | null = null;
    if (scope === "client") {
      const { data: row } = await guard.admin
        .from("treasury_metrics")
        .select("id, tenant_id, client_user_id, definition")
        .eq("id", created.id)
        .single();
      if (row?.client_user_id) {
        computed = await computeMetricValue(guard.admin, {
          id: row.id,
          tenant_id: row.tenant_id,
          client_user_id: row.client_user_id,
          definition: row.definition as Json,
        });
      }
    }

    const { data: full } = await guard.admin
      .from("treasury_metrics")
      .select("*")
      .eq("id", created.id)
      .single();

    return NextResponse.json(
      { metric: full ?? created, computed },
      { status: 201 }
    );
  } catch (e) {
    const err = e as Error & {
      fieldErrors?: Array<{ path: string; message: string }>;
    };
    return NextResponse.json(
      {
        error: err.message,
        fieldErrors: err.fieldErrors,
      },
      { status: 400 }
    );
  }
}
