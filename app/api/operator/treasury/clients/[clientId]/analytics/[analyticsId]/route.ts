import { NextResponse } from "next/server";
import type { Json } from "@/lib/database.types";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { findMetricForClient } from "@/lib/treasury/metrics-eval";
import {
  assembleAnalyticsBoard,
  normalizeBoardRow,
  type AnalyticsBoardItem,
} from "@/lib/treasury/analytics-assemble";

type RouteContext = {
  params: Promise<{ clientId: string; analyticsId: string }>;
};

async function loadBoard(
  admin: Parameters<typeof findMetricForClient>[0],
  tenantId: string,
  clientId: string,
  analyticsId: string
) {
  const { data, error } = await admin
    .from("treasury_analytics")
    .select("*")
    .eq("id", analyticsId)
    .eq("tenant_id", tenantId)
    .eq("client_user_id", clientId)
    .neq("status", "archived")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalizeBoardRow(data as Record<string, unknown>) : null;
}

/** Spec B7 — assembled live board. */
export async function GET(_request: Request, context: RouteContext) {
  const { clientId, analyticsId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  try {
    const board = await loadBoard(
      guard.admin,
      guard.grant.tenantId,
      clientId,
      analyticsId
    );
    if (!board) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const assembled = await assembleAnalyticsBoard(guard.admin, board);
    return NextResponse.json(assembled);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { clientId, analyticsId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const before = await loadBoard(
    guard.admin,
    guard.grant.tenantId,
    clientId,
    analyticsId
  );
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: {
    title?: string;
    description?: string;
    metric_ids?: string[];
    items?: AnalyticsBoardItem[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: {
    title?: string;
    description?: string;
    items?: Json;
  } = {};

  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) {
      return NextResponse.json({ error: "title required" }, { status: 400 });
    }
    update.title = title;
  }
  if (body.description !== undefined) {
    update.description = body.description.trim();
  }

  let nextItems: AnalyticsBoardItem[] | undefined;
  if (Array.isArray(body.items)) {
    nextItems = body.items.filter((i) => i?.metric_id);
  } else if (Array.isArray(body.metric_ids)) {
    nextItems = body.metric_ids.map((metric_id) => ({ metric_id }));
  }
  if (nextItems) {
    for (const it of nextItems) {
      const m = await findMetricForClient(
        guard.admin,
        guard.grant.tenantId,
        clientId,
        it.metric_id
      );
      if (!m) {
        return NextResponse.json(
          { error: `Metric not found: ${it.metric_id}` },
          { status: 400 }
        );
      }
    }
    update.items = nextItems as unknown as Json;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }

  const { data, error } = await guard.admin
    .from("treasury_analytics")
    .update(update)
    .eq("id", analyticsId)
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    board: normalizeBoardRow(data as Record<string, unknown>),
  });
}

/** Soft-archive. */
export async function DELETE(_request: Request, context: RouteContext) {
  const { clientId, analyticsId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const before = await loadBoard(
    guard.admin,
    guard.grant.tenantId,
    clientId,
    analyticsId
  );
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await guard.admin
    .from("treasury_analytics")
    .update({ status: "archived" })
    .eq("id", analyticsId)
    .eq("tenant_id", guard.grant.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
