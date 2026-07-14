import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptForClient } from "@/lib/server/envelope-crypto";
import { plaid } from "@/lib/server/plaid";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export async function disconnectTreasurySource(
  admin: AdminClient,
  clientUserId: string,
  sourceId: string
): Promise<{ ok: true } | { error: string; status: number }> {
  if (sourceId === "csv-manual") {
    const { error: txErr } = await admin
      .from("treasury_transactions")
      .delete()
      .eq("client_user_id", clientUserId)
      .eq("source", "csv");

    if (txErr) {
      return { error: "Failed to remove CSV transactions", status: 500 };
    }

    const { error: acctErr } = await admin
      .from("treasury_accounts")
      .delete()
      .eq("client_user_id", clientUserId)
      .eq("source", "csv");

    if (acctErr) {
      return { error: "Failed to remove CSV accounts", status: 500 };
    }

    return { ok: true };
  }

  const { data: item, error: loadErr } = await admin
    .from("plaid_items")
    .select("id, access_token_ciphertext")
    .eq("id", sourceId)
    .eq("client_user_id", clientUserId)
    .maybeSingle();

  if (loadErr) {
    return { error: "Failed to load source", status: 500 };
  }

  if (!item) {
    return { error: "Source not found", status: 404 };
  }

  try {
    const accessToken = await decryptForClient(
      admin,
      clientUserId,
      item.access_token_ciphertext
    );
    await plaid.itemRemove({ access_token: accessToken });
  } catch (err) {
    console.warn("[treasury-disconnect] Plaid itemRemove failed (continuing)", err);
  }

  const { error: delErr } = await admin
    .from("plaid_items")
    .delete()
    .eq("id", sourceId)
    .eq("client_user_id", clientUserId);

  if (delErr) {
    return { error: "Failed to remove bank connection", status: 500 };
  }

  return { ok: true };
}
