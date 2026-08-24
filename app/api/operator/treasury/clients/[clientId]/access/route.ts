import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getPrimaryOperatorTenantId,
  getTier,
} from "@/lib/auth/rbac";

type RouteContext = { params: Promise<{ clientId: string }> };

type Body = { action?: "suspend" | "reactivate" | "revoke" };

/** Spec B10 Part G — flip client_module_access.status. */
export async function PATCH(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tier = await getTier(supabase, user.id);
  if (tier !== "operator" && tier !== "global_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenantId = await getPrimaryOperatorTenantId(supabase, user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "No operator tenant" }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;
  if (
    action !== "suspend" &&
    action !== "reactivate" &&
    action !== "revoke"
  ) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: mod } = await admin
    .from("modules")
    .select("id")
    .eq("slug", "treasury")
    .maybeSingle();
  if (!mod) {
    return NextResponse.json({ error: "treasury module missing" }, { status: 500 });
  }

  const { data: grant } = await admin
    .from("client_module_access")
    .select("id, status")
    .eq("client_user_id", clientId)
    .eq("module_id", mod.id)
    .eq("distributor_tenant_id", tenantId)
    .maybeSingle();

  if (!grant) {
    return NextResponse.json({ error: "Grant not found" }, { status: 404 });
  }

  if (action === "suspend") {
    const { data, error } = await supabase.rpc("suspend_operator_client_access", {
      p_grant_id: grant.id,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, result: data });
  }

  if (action === "reactivate") {
    const { data, error } = await supabase.rpc(
      "reactivate_operator_client_access",
      { p_grant_id: grant.id }
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, result: data });
  }

  // revoke
  const { error } = await admin
    .from("client_module_access")
    .update({ status: "revoked" })
    .eq("id", grant.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await admin
    .from("distributor_client_invites")
    .update({ status: "revoked" })
    .eq("tenant_id", tenantId)
    .eq("client_user_id", clientId)
    .eq("status", "pending");

  return NextResponse.json({ ok: true, status: "revoked" });
}
