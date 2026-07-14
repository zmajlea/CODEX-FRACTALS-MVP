import "server-only";

import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

type ManualAccountBody = {
  name?: string;
  type?: string;
  subtype?: string;
  current_balance?: number | null;
  available_balance?: number | null;
  iso_currency_code?: string | null;
};

const ACCOUNT_TYPES = ["depository", "credit", "loan", "investment", "other"] as const;

function parseManualBody(body: ManualAccountBody) {
  const name = body.name?.trim();
  if (!name) {
    return { error: "name is required", status: 400 as const };
  }
  const type = body.type?.trim() || "depository";
  if (!ACCOUNT_TYPES.includes(type as (typeof ACCOUNT_TYPES)[number])) {
    return { error: "Invalid account type", status: 400 as const };
  }
  const subtype = body.subtype?.trim() || (type === "credit" ? "credit card" : "checking");
  return {
    name,
    type,
    subtype,
    current_balance: body.current_balance ?? null,
    available_balance: body.available_balance ?? body.current_balance ?? null,
    iso_currency_code: body.iso_currency_code?.trim()?.toUpperCase() || "USD",
    account_id: `csv:${name}`,
  };
}

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

export async function POST(request: Request) {
  const auth = await requireTreasuryClient();
  if ("error" in auth && auth.error) return auth.error;
  const { user, admin } = auth as { user: { id: string }; admin: ReturnType<typeof createSupabaseAdminClient> };

  let body: ManualAccountBody;
  try {
    body = (await request.json()) as ManualAccountBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseManualBody(body);
  if ("status" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const { data: existing } = await admin
    .from("treasury_accounts")
    .select("account_id")
    .eq("client_user_id", user.id)
    .eq("account_id", parsed.account_id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "An account with this name already exists" }, { status: 409 });
  }

  const { data: row, error } = await admin
    .from("treasury_accounts")
    .insert({
      source: "csv",
      plaid_item_id: null,
      client_user_id: user.id,
      account_id: parsed.account_id,
      name: parsed.name,
      type: parsed.type,
      subtype: parsed.subtype,
      current_balance: parsed.current_balance,
      available_balance: parsed.available_balance,
      iso_currency_code: parsed.iso_currency_code,
    })
    .select("account_id, name, type, subtype, current_balance, available_balance, iso_currency_code")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }

  return NextResponse.json({ account: row });
}
