import { NextResponse } from "next/server";
import { getPrimaryOperatorTenantId, getTier } from "@/lib/auth/rbac";
import {
  writeOperatorTreasuryReadAudit,
} from "@/lib/server/operator-treasury-audit";
import {
  buildOperatorInboxItems,
  inboxUnreadCount,
} from "@/lib/server/treasury-recommendations";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

type TreasuryClientGrantRow = {
  client_user_id: string;
  client_name: string;
};

type PatchBody = {
  action?: string;
  recommendation_id?: string;
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tier = await getTier(supabase, user.id);
  let tenantId = await getPrimaryOperatorTenantId(supabase, user.id);
  const url = new URL(request.url);
  const tenantParam = url.searchParams.get("tenantId");
  if (!tenantId && tier === "global_admin" && tenantParam) {
    tenantId = tenantParam;
  }
  if (!tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: clientsData, error: clientsErr } = await supabase.rpc(
    "list_operator_treasury_clients",
    { p_tenant_id: tenantId }
  );
  if (clientsErr) {
    return NextResponse.json({ error: clientsErr.message }, { status: 500 });
  }

  const clients = (Array.isArray(clientsData) ? clientsData : []) as TreasuryClientGrantRow[];
  const allowedIds = new Set(clients.map((c) => c.client_user_id));
  const clientNames = new Map(clients.map((c) => [c.client_user_id, c.client_name]));

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("treasury_recommendations")
    .select("*")
    .eq("operator_tenant_id", tenantId)
    .in("status", ["accepted", "in_progress", "done", "declined"])
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const filtered = (data ?? []).filter((r) =>
    allowedIds.has(r.client_user_id)
  ) as TreasuryRecommendationRow[];

  const items = buildOperatorInboxItems(filtered, clientNames);
  const unreadCount = inboxUnreadCount(items);

  await writeOperatorTreasuryReadAudit(admin, {
    actorUserId: user.id,
    clientUserId: user.id,
    tenantId,
    surface: "inbox",
  });

  return NextResponse.json({ items, unreadCount });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tier = await getTier(supabase, user.id);
  let tenantId = await getPrimaryOperatorTenantId(supabase, user.id);
  const url = new URL(request.url);
  const tenantParam = url.searchParams.get("tenantId");
  if (!tenantId && tier === "global_admin" && tenantParam) {
    tenantId = tenantParam;
  }
  if (!tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "mark_seen" || !body.recommendation_id) {
    return NextResponse.json({ error: "Missing action or recommendation_id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("treasury_recommendations")
    .update({ operator_seen_at: now })
    .eq("id", body.recommendation_id)
    .eq("operator_tenant_id", tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
