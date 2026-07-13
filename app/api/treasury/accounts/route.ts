import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { syncTreasuryForClient } from "@/lib/server/treasury-sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export type {
  TreasuryTransaction,
  TreasuryAccountView,
  TreasuryInstitutionView,
} from "@/lib/treasury/types";

export async function GET() {
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

  const admin = createSupabaseAdminClient();

  try {
    const result = await syncTreasuryForClient(admin, user.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[treasury/accounts]", err);
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 500 });
  }
}
