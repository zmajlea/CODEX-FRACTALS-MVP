import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import {
  buildSummaryResponse,
  clampSummaryPeriods,
  parseSummaryGranularity,
} from "@/lib/server/treasury-summary-response";
import { querySummary } from "@/lib/server/treasury-rules";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";
import { lastNPeriodStarts } from "@/lib/treasury/period-bounds";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const granularity = parseSummaryGranularity(url);
  const periods = clampSummaryPeriods(url.searchParams.get("periods"));
  const accountId = url.searchParams.get("account_id") ?? undefined;

  const { from, to, starts } = lastNPeriodStarts(granularity, periods);
  const admin = createSupabaseAdminClient();

  try {
    const dateRows = await fetchAllRows((rangeFrom, rangeTo) => {
      let q = admin
        .from("treasury_transactions")
        .select("posted_date")
        .eq("client_user_id", user.id)
        .eq("is_removed", false)
        .eq("pending", false)
        .not("posted_date", "is", null)
        .order("posted_date", { ascending: true })
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo);
      if (accountId) q = q.eq("account_id", accountId);
      return q;
    });

    let dataFirst: string | null = null;
    let dataLast: string | null = null;
    for (const row of dateRows) {
      const d = row.posted_date as string;
      if (!dataFirst || d < dataFirst) dataFirst = d;
      if (!dataLast || d > dataLast) dataLast = d;
    }

    const sparse = await querySummary(admin, user.id, {
      bucket: granularity,
      from,
      to,
      accountId,
    });

    return NextResponse.json(
      buildSummaryResponse(sparse, {
        granularity,
        periods,
        from,
        to,
        starts,
        dataFirst,
        dataLast,
      })
    );
  } catch (err) {
    console.error("[treasury/summary]", err);
    return NextResponse.json({ error: "Failed to load summary" }, { status: 500 });
  }
}
