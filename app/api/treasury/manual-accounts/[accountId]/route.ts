import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

type RouteContext = { params: Promise<{ accountId: string }> };

type ManualAccountBody = {
  name?: string;
  type?: string;
  subtype?: string;
  current_balance?: number | null;
  available_balance?: number | null;
  iso_currency_code?: string | null;
};

const ACCOUNT_TYPES = ["depository", "credit", "loan", "investment", "other"] as const;

async function requireTreasuryClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const allowed = await canAccessModule(supabase, user.id, "treasury");
  if (!allowed) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user, admin: createSupabaseAdminClient() };
}

async function loadManualAccount(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  clientUserId: string,
  accountId: string
) {
  const { data, error } = await admin
    .from("treasury_accounts")
    .select("account_id, source, name")
    .eq("client_user_id", clientUserId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) {
    return { error: NextResponse.json({ error: "Failed to load account" }, { status: 500 }) };
  }
  if (!data) {
    return { error: NextResponse.json({ error: "Account not found" }, { status: 404 }) };
  }
  if (data.source !== "csv") {
    return {
      error: NextResponse.json(
        { error: "Bank-synced accounts cannot be edited or removed individually" },
        { status: 403 }
      ),
    };
  }
  return { account: data };
}

export async function PATCH(request: Request, context: RouteContext) {
  const { accountId: rawId } = await context.params;
  const accountId = decodeURIComponent(rawId);

  const auth = await requireTreasuryClient();
  if ("error" in auth && auth.error) return auth.error;
  const { user, admin } = auth as { user: { id: string }; admin: ReturnType<typeof createSupabaseAdminClient> };

  const loaded = await loadManualAccount(admin, user.id, accountId);
  if ("error" in loaded && loaded.error) return loaded.error;

  let body: ManualAccountBody;
  try {
    body = (await request.json()) as ManualAccountBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: {
    name?: string;
    type?: string;
    subtype?: string | null;
    current_balance?: number | null;
    available_balance?: number | null;
    iso_currency_code?: string;
  } = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    updates.name = name;
  }
  if (body.type !== undefined) {
    const type = body.type.trim();
    if (!ACCOUNT_TYPES.includes(type as (typeof ACCOUNT_TYPES)[number])) {
      return NextResponse.json({ error: "Invalid account type" }, { status: 400 });
    }
    updates.type = type;
  }
  if (body.subtype !== undefined) {
    updates.subtype = body.subtype.trim() || null;
  }
  if (body.current_balance !== undefined) {
    updates.current_balance = body.current_balance;
  }
  if (body.available_balance !== undefined) {
    updates.available_balance = body.available_balance;
  }
  if (body.iso_currency_code !== undefined) {
    updates.iso_currency_code = body.iso_currency_code?.trim()?.toUpperCase() || "USD";
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: row, error } = await admin
    .from("treasury_accounts")
    .update(updates)
    .eq("client_user_id", user.id)
    .eq("account_id", accountId)
    .eq("source", "csv")
    .select("account_id, name, type, subtype, current_balance, available_balance, iso_currency_code")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  return NextResponse.json({ account: row });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { accountId: rawId } = await context.params;
  const accountId = decodeURIComponent(rawId);

  const auth = await requireTreasuryClient();
  if ("error" in auth && auth.error) return auth.error;
  const { user, admin } = auth as { user: { id: string }; admin: ReturnType<typeof createSupabaseAdminClient> };

  const loaded = await loadManualAccount(admin, user.id, accountId);
  if ("error" in loaded && loaded.error) return loaded.error;

  const { error: txErr } = await admin
    .from("treasury_transactions")
    .delete()
    .eq("client_user_id", user.id)
    .eq("source", "csv")
    .eq("account_id", accountId);

  if (txErr) {
    return NextResponse.json({ error: "Failed to remove account transactions" }, { status: 500 });
  }

  const { error: acctErr } = await admin
    .from("treasury_accounts")
    .delete()
    .eq("client_user_id", user.id)
    .eq("account_id", accountId)
    .eq("source", "csv");

  if (acctErr) {
    return NextResponse.json({ error: "Failed to remove account" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
