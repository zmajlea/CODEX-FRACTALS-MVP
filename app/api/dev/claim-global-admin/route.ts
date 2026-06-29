import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { claimBootstrapGlobalAdmin } from "@/lib/ff/dev-admin";

/**
 * Dev-only: claim the first global_admin slot.
 * Omitted from production — returns 404 when NODE_ENV === 'production'.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ok = await claimBootstrapGlobalAdmin(supabase);
    return NextResponse.json({ ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claim failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
