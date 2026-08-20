import { NextResponse } from "next/server";
import type { Json } from "@/lib/database.types";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { findMetricForClient } from "@/lib/treasury/metrics-eval";
import {
  normalizeBoardRow,
  type AnalyticsBoardItem,
} from "@/lib/treasury/analytics-assemble";

type RouteContext = { params: Promise<{ clientId: string }> };

function itemsFromMetricIds(ids: string[]): AnalyticsBoardItem[] {
  return ids.map((metric_id) => ({ metric_id }));
}

/** Spec B7 — list + create analytics boards. */
export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data, error } = await guard.admin
    .from("treasury_analytics")
    .select(
      "id, title, description, items, status, shared_at, shared_by, created_at, updated_at"
    )
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const boards = (data ?? []).map((row) => {
    const items = Array.isArray(row.items) ? row.items : [];
    return {
      ...row,
      metric_count: items.length,
    };
  });

  return NextResponse.json({ boards });
}

export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: {
    title?: string;
    description?: string;
    metric_ids?: string[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = body.title?.trim() ?? "";
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  const metricIds = Array.isArray(body.metric_ids) ? body.metric_ids : [];
  if (!metricIds.length) {
    return NextResponse.json({ error: "metric_ids required" }, { status: 400 });
  }

  for (const id of metricIds) {
    const m = await findMetricForClient(
      guard.admin,
      guard.grant.tenantId,
      clientId,
      id
    );
    if (!m) {
      return NextResponse.json(
        { error: `Metric not found: ${id}` },
        { status: 400 }
      );
    }
  }

  const { data, error } = await guard.admin
    .from("treasury_analytics")
    .insert({
      tenant_id: guard.grant.tenantId,
      client_user_id: clientId,
      title,
      description: (body.description ?? "").trim(),
      items: itemsFromMetricIds(metricIds) as unknown as Json,
      status: "draft",
      created_by: guard.user.id,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { board: normalizeBoardRow(data as Record<string, unknown>) },
    { status: 201 }
  );
}
