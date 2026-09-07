import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { isRegisteredModelType } from "@/lib/treasury/model-kinds";
import { previewModelKind } from "@/lib/treasury/study-assemble-server";
import type { StudyType } from "@/lib/treasury/studies";

type RouteContext = { params: Promise<{ clientId: string }> };

type PreviewBody = {
  type?: StudyType | string;
  name?: string;
  params?: unknown;
  scenarios?: unknown;
  scope?: { accountId?: string; label?: string | null } | null;
  /** Required for external_model identity compute. */
  derived_snapshot?: unknown;
  status?: string | null;
  openingBalance?: number | null;
};

/**
 * Models rethink Phase 1 — live Model preview (same load→compute→toSnapshot as place).
 * Never persists. Body: { type, params?, scenarios?, scope?, derived_snapshot?, … }.
 */
export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: PreviewBody;
  try {
    body = (await request.json()) as PreviewBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = typeof body.type === "string" ? body.type : "";
  if (!type || !isRegisteredModelType(type)) {
    return NextResponse.json(
      { error: "type must be a registered model kind" },
      { status: 400 }
    );
  }

  // Preview synthesizes a confirmed external so identity compute can run without a row.
  const status =
    body.status ??
    (type === "external_model" ? "confirmed" : null);

  const row: Record<string, unknown> = {
    id: "preview",
    name: body.name?.trim() || "Preview",
    type,
    status,
    params: body.params ?? {},
    scenarios: body.scenarios ?? [],
    scope: body.scope ?? null,
    derived_snapshot: body.derived_snapshot ?? null,
  };

  const out = await previewModelKind(guard.admin, clientId, row, {
    openingBalance: body.openingBalance ?? null,
  });

  if (!out) {
    return NextResponse.json(
      { error: "Preview failed — check type, params, and inputs" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    snapshot: out.snapshot,
    confidence: out.confidence,
    explain: out.explain,
  });
}
