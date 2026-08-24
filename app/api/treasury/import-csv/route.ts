import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { upsertTransactions } from "@/lib/server/treasury-ingest";
import { applyRulesForClient } from "@/lib/server/treasury-rules";
import {
  MissingAccountError,
  parseTreasuryCsv,
  upsertCsvAccounts,
} from "@/lib/treasury/csv-import";

/**
 * Spec B10 Part D — client self-upload CSV.
 * Auth via session + active grant; ledger writes use admin scoped to auth.uid() only
 * (table writes remain service-role by design).
 */
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

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const accountLabel = form.get("account_label");
  const csvText = await file.text();
  const clientId = user.id;
  const admin = createSupabaseAdminClient();

  try {
    const parsed = parseTreasuryCsv(csvText, clientId, {
      accountLabel:
        typeof accountLabel === "string" && accountLabel.trim()
          ? accountLabel.trim()
          : undefined,
    });

    await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
    const result = await upsertTransactions(
      admin,
      clientId,
      parsed.rows,
      "csv"
    );
    await applyRulesForClient(admin, clientId);

    return NextResponse.json({
      ...parsed.reconcile,
      imported: result.inserted,
      duplicatesIgnored: result.updated,
    });
  } catch (e) {
    if (e instanceof MissingAccountError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
