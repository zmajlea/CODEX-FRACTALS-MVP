import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { encryptForClient } from "@/lib/server/envelope-crypto";
import { plaid } from "@/lib/server/plaid";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

type Body = {
  public_token?: string;
  institution_name?: string;
  institution_id?: string;
  force?: boolean;
};

async function resolveGrantTenantId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const { data: mod } = await supabase
    .from("modules")
    .select("id")
    .eq("slug", "treasury")
    .maybeSingle();

  if (!mod) return null;

  const { data: grant } = await supabase
    .from("client_module_access")
    .select("distributor_tenant_id")
    .eq("client_user_id", userId)
    .eq("module_id", mod.id)
    .eq("status", "active")
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return grant?.distributor_tenant_id ?? null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await canAccessModule(supabase, user.id, "treasury");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const publicToken = body.public_token?.trim();
  if (!publicToken) {
    return NextResponse.json({ error: "Missing public_token" }, { status: 400 });
  }

  const institutionId = body.institution_id?.trim() || null;
  const admin = createSupabaseAdminClient();

  if (institutionId) {
    const { data: existing } = await admin
      .from("plaid_items")
      .select("id, institution_name")
      .eq("client_user_id", user.id)
      .eq("institution_id", institutionId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (existing && body.force !== true) {
      return NextResponse.json({
        status: "already_linked",
        institution_name: existing.institution_name ?? body.institution_name ?? null,
      });
    }
  }

  try {
    const exchange = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;
    const institutionName = body.institution_name?.trim() || null;

    const ciphertext = await encryptForClient(admin, user.id, accessToken);
    const distributorTenantId = await resolveGrantTenantId(supabase, user.id);

    const { data: itemRow, error: itemErr } = await admin
      .from("plaid_items")
      .upsert(
        {
          client_user_id: user.id,
          distributor_tenant_id: distributorTenantId,
          plaid_item_id: itemId,
          institution_name: institutionName,
          institution_id: institutionId,
          status: "active",
          access_token_ciphertext: ciphertext,
        },
        { onConflict: "client_user_id,plaid_item_id" }
      )
      .select("id")
      .single();

    if (itemErr || !itemRow) {
      throw itemErr ?? new Error("Failed to store plaid item");
    }

    const balances = await plaid.accountsBalanceGet({ access_token: accessToken });
    const accounts = balances.data.accounts;
    const accountRows = accounts.map((acct) => ({
      source: "plaid" as const,
      plaid_item_id: itemRow.id,
      client_user_id: user.id,
      account_id: acct.account_id,
      name: acct.name,
      mask: acct.mask,
      type: acct.type,
      subtype: acct.subtype,
      current_balance: acct.balances.current,
      available_balance: acct.balances.available,
      iso_currency_code: acct.balances.iso_currency_code,
    }));

    if (accountRows.length > 0) {
      const { error: acctErr } = await admin
        .from("treasury_accounts")
        .upsert(accountRows, { onConflict: "client_user_id,account_id" });
      if (acctErr) throw acctErr;
    }

    const { syncTransactionsForClient } = await import("@/lib/server/treasury-sync");
    await syncTransactionsForClient(admin, user.id);

    return NextResponse.json({
      ok: true,
      institution_name: institutionName,
      account_count: accounts.length,
    });
  } catch (err) {
    console.error("[treasury/exchange]", err);
    return NextResponse.json(
      { error: "Failed to link bank account" },
      { status: 502 }
    );
  }
}
