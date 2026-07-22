import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  DEMO_INSTRUMENT_CLIENT_EMAIL,
  isProtectedDemoFfmClient,
} from "@/lib/treasury/is-demo-tenant";

type RouteContext = {
  params: Promise<{ clientId: string; accountId: string }>;
};
type AdminClient = SupabaseClient<Database>;

async function resolveClientEmail(
  admin: AdminClient,
  clientId: string
): Promise<string | null> {
  const { data } = await admin
    .from("users")
    .select("email")
    .eq("id", clientId)
    .maybeSingle();
  return data?.email ?? null;
}

/**
 * Spec 53C — operator preview + delete for one CSV import (account unit).
 * GET: counts for confirm. DELETE: audit first (literal payload), then txs + account.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { clientId, accountId: rawId } = await context.params;
  const accountId = decodeURIComponent(rawId);
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const clientEmail = await resolveClientEmail(guard.admin, clientId);
  if (isProtectedDemoFfmClient({ clientId, clientEmail })) {
    return NextResponse.json(
      {
        error: "This record is protected. The demo FFM book cannot be modified.",
        code: "protected_demo_ffm",
        client_user_id: clientId,
        client_email: clientEmail ?? DEMO_INSTRUMENT_CLIENT_EMAIL,
      },
      { status: 403 }
    );
  }

  const { data: acct, error: acctErr } = await guard.admin
    .from("treasury_accounts")
    .select("account_id, name, mask, source, current_balance, iso_currency_code")
    .eq("client_user_id", clientId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (acctErr) {
    return NextResponse.json({ error: acctErr.message }, { status: 500 });
  }
  if (!acct) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (acct.source !== "csv") {
    return NextResponse.json(
      { error: "Only CSV imports can be removed here", code: "not_csv_import" },
      { status: 400 }
    );
  }

  const { count: transactionCount, error: txCountErr } = await guard.admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("source", "csv")
    .eq("account_id", accountId)
    .eq("is_removed", false);

  if (txCountErr) {
    return NextResponse.json({ error: txCountErr.message }, { status: 500 });
  }

  return NextResponse.json({
    account_id: acct.account_id,
    name: acct.name,
    mask: acct.mask,
    source: acct.source,
    current_balance: acct.current_balance,
    iso_currency_code: acct.iso_currency_code,
    transaction_count: transactionCount ?? 0,
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { clientId, accountId: rawId } = await context.params;
  const accountId = decodeURIComponent(rawId);
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const clientEmail = await resolveClientEmail(guard.admin, clientId);
  if (isProtectedDemoFfmClient({ clientId, clientEmail })) {
    return NextResponse.json(
      {
        error: "This record is protected. The demo FFM book cannot be modified.",
        code: "protected_demo_ffm",
        client_user_id: clientId,
        client_email: clientEmail ?? DEMO_INSTRUMENT_CLIENT_EMAIL,
      },
      { status: 403 }
    );
  }

  const { data: acct, error: acctErr } = await guard.admin
    .from("treasury_accounts")
    .select("account_id, name, mask, source")
    .eq("client_user_id", clientId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (acctErr) {
    return NextResponse.json({ error: acctErr.message }, { status: 500 });
  }
  if (!acct) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (acct.source !== "csv") {
    return NextResponse.json(
      { error: "Only CSV imports can be removed here", code: "not_csv_import" },
      { status: 400 }
    );
  }

  const { count: transactionCount, error: txCountErr } = await guard.admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("source", "csv")
    .eq("account_id", accountId);

  if (txCountErr) {
    return NextResponse.json({ error: txCountErr.message }, { status: 500 });
  }

  const deletedTxCount = transactionCount ?? 0;
  const accountLabel = acct.mask ?? acct.name ?? accountId;

  // Audit first with literal values — user_audit_events.payload has no FK to accounts.
  await writeTreasuryAudit(guard.admin, {
    actorUserId: guard.user.id,
    eventType: "treasury_account_import_deleted",
    payload: {
      client_user_id: clientId,
      account_id: accountId,
      account_mask: acct.mask,
      account_name: acct.name,
      account_label: accountLabel,
      source: "csv",
      transactions_deleted: deletedTxCount,
      accounts_deleted: 1,
    },
  });

  const { error: txErr } = await guard.admin
    .from("treasury_transactions")
    .delete()
    .eq("client_user_id", clientId)
    .eq("source", "csv")
    .eq("account_id", accountId);

  if (txErr) {
    return NextResponse.json(
      { error: "Failed to remove account transactions" },
      { status: 500 }
    );
  }

  const { error: delAcctErr } = await guard.admin
    .from("treasury_accounts")
    .delete()
    .eq("client_user_id", clientId)
    .eq("source", "csv")
    .eq("account_id", accountId);

  if (delAcctErr) {
    return NextResponse.json({ error: "Failed to remove account" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    account_id: accountId,
    transactions_deleted: deletedTxCount,
    accounts_deleted: 1,
  });
}
