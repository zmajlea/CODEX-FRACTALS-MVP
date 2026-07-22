import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import {
  buildSummaryResponse,
  clampSummaryPeriods,
  parseSummaryGranularity,
} from "@/lib/server/treasury-summary-response";
import { fetchSummaryDataSpan } from "@/lib/server/treasury-summary-data-span";
import { querySummary } from "@/lib/server/treasury-rules";
import { lastNPeriodStarts, minIso, todayIso } from "@/lib/treasury/period-bounds";
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

  const admin = createSupabaseAdminClient();

  try {
    const dataSpan = await fetchSummaryDataSpan(admin, user.id, accountId);
    const dataFirst = dataSpan?.first ?? null;
    const dataLast = dataSpan?.last ?? null;
    const today = todayIso();
    const through = dataLast ? minIso(today, dataLast) : today;
    const { from, to, starts } = lastNPeriodStarts(granularity, periods, through);

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
