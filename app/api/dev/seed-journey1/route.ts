import { readFile } from "fs/promises";
import { join } from "path";
import { NextResponse, type NextRequest } from "next/server";
import { seedJourney1Treasury } from "@/lib/server/seed-journey1-treasury";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Dev-only: seed journey1-test@codexone.test with demo treasury CSV, rules, and recommendations.
 * Returns 404 in production.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const secret = process.env.SEED_SECRET;
  const headerSecret = request.headers.get("x-seed-secret");
  if (!secret || headerSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const csvPath = join(process.cwd(), "docs", "demo-treasury-summit.csv");
    const csvText = await readFile(csvPath, "utf8");
    const admin = createSupabaseAdminClient();
    const result = await seedJourney1Treasury(admin, csvText);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Seed failed";
    const status =
      message.includes("not found") ||
      message.includes("Refusing") ||
      message.includes("No active treasury grant")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
