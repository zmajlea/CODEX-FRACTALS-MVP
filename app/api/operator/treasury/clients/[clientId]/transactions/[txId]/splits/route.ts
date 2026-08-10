import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  loadTransactionSplits,
  replaceTransactionSplits,
} from "@/lib/server/treasury-transaction-splits";
import type { TransactionSplitSlice } from "@/lib/treasury/transaction-splits";

type RouteContext = { params: Promise<{ clientId: string; txId: string }> };

function parseSlices(raw: unknown): TransactionSplitSlice[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TransactionSplitSlice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const label = (item as { label?: unknown }).label;
    const amount = (item as { amount?: unknown }).amount;
    if (typeof label !== "string" || typeof amount !== "number") return null;
    out.push({ label, amount });
  }
  return out;
}

export async function GET(_request: Request, context: RouteContext) {
  const { clientId, txId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: tx, error: txErr } = await guard.admin
    .from("treasury_transactions")
    .select("id")
    .eq("id", txId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (txErr || !tx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const splits = await loadTransactionSplits(guard.admin, txId);
    return NextResponse.json({ splits });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Load failed" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { clientId, txId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: { slices?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slices = parseSlices(body.slices ?? []);
  if (slices === null) {
    return NextResponse.json({ error: "slices must be an array of {label, amount}" }, { status: 400 });
  }

  const { data: tx, error: txErr } = await guard.admin
    .from("treasury_transactions")
    .select("id, amount")
    .eq("id", txId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (txErr || !tx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await replaceTransactionSplits(
      guard.admin,
      txId,
      Number(tx.amount),
      slices
    );
    const saved = await loadTransactionSplits(guard.admin, txId);
    return NextResponse.json({ splits: saved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed";
    const status = msg.includes("sum") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { clientId, txId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: tx, error: txErr } = await guard.admin
    .from("treasury_transactions")
    .select("id, amount")
    .eq("id", txId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (txErr || !tx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await replaceTransactionSplits(guard.admin, txId, Number(tx.amount), []);
    return NextResponse.json({ splits: [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 500 }
    );
  }
}
