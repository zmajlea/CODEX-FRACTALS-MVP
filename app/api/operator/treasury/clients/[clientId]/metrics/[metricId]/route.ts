import { NextResponse } from "next/server";
import type { Json } from "@/lib/database.types";
import {
  kindFromDefinition,
  validateMetricDefinition,
} from "@/lib/mcp/metrics-schema";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  computeMetricValue,
  detectMetricCycle,
  findMetricForClient,
  resolveMetricRefs,
} from "@/lib/treasury/metrics-eval";

type RouteContext = {
  params: Promise<{ clientId: string; metricId: string }>;
};

/** Spec B4/B5 — edit name/description/definition (client-or-null ownership). */
export async function PATCH(request: Request, context: RouteContext) {
  const { clientId, metricId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const before = await findMetricForClient(
    guard.admin,
    guard.grant.tenantId,
    clientId,
    metricId
  );
  if (!before) {
    return NextResponse.json({ error: "Metric not found" }, { status: 404 });
  }

  let body: {
    name?: string;
    description?: string;
    definition?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: {
    name?: string;
    description?: string;
    definition?: Json;
    kind?: string;
    version?: number;
    computed_value?: Json | null;
    computed_at?: string | null;
  } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    update.name = name;
  }
  if (body.description !== undefined) {
    update.description = body.description.trim();
  }

  if (body.definition !== undefined) {
    const validated = validateMetricDefinition(body.definition);
    if (!validated.ok) {
      return NextResponse.json(
        { error: "Invalid definition", fieldErrors: validated.errors },
        { status: 400 }
      );
    }
    const nameForCycle = update.name ?? before.name;
    const unresolved = await resolveMetricRefs(
      guard.admin,
      guard.grant.tenantId,
      before.client_user_id ?? clientId,
      validated.definition
    );
    if (unresolved) {
      return NextResponse.json({ error: unresolved }, { status: 400 });
    }
    const cycle = await detectMetricCycle(
      guard.admin,
      guard.grant.tenantId,
      before.client_user_id ?? clientId,
      nameForCycle,
      validated.definition
    );
    if (cycle) {
      return NextResponse.json({ error: cycle }, { status: 400 });
    }
    update.definition = validated.definition as unknown as Json;
    update.kind = kindFromDefinition(validated.definition);
    update.version = (before.version ?? 1) + 1;
    update.computed_value = null;
    update.computed_at = null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }

  const { data: row, error } = await guard.admin
    .from("treasury_metrics")
    .update(update)
    .eq("id", metricId)
    .eq("tenant_id", guard.grant.tenantId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let computed: { value?: number; computed_at: string } | null = null;
  if (body.definition !== undefined && row.client_user_id) {
    try {
      const out = await computeMetricValue(guard.admin, {
        id: row.id,
        tenant_id: row.tenant_id,
        client_user_id: row.client_user_id,
        definition: row.definition as Json,
      });
      computed = { value: out.value, computed_at: out.computed_at };
      const { data: refreshed } = await guard.admin
        .from("treasury_metrics")
        .select("*")
        .eq("id", metricId)
        .single();
      return NextResponse.json({ metric: refreshed ?? row, computed });
    } catch {
      /* leave cleared cache */
    }
  }

  return NextResponse.json({ metric: row, computed });
}

/** Spec B4 — soft-discard; client-or-null ownership (hardened from B3). */
export async function DELETE(_request: Request, context: RouteContext) {
  const { clientId, metricId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const before = await findMetricForClient(
    guard.admin,
    guard.grant.tenantId,
    clientId,
    metricId
  );
  if (!before) {
    return NextResponse.json({ error: "Metric not found" }, { status: 404 });
  }

  const { error } = await guard.admin
    .from("treasury_metrics")
    .update({ status: "discarded" })
    .eq("id", metricId)
    .eq("tenant_id", guard.grant.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
