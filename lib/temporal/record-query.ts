"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";
import { fetchVaultTemporalObjects } from "@/lib/temporal/record-fetch";

export type QueryRunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "identifying" }
  | { status: "completed"; count: number; candidates: PortfolioTemporalObject[] }
  | { status: "failed"; message: string };

export async function runRecordQuery(
  supabase: SupabaseClient<Database>,
  vaultId: string,
  vaultName: string,
  query: string
): Promise<QueryRunState> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return { status: "idle" };

  try {
    const all = await fetchVaultTemporalObjects(supabase, vaultId, vaultName);
    const sealedMatch = all.find(
      (o) =>
        o.isSealed &&
        !o.isLocked &&
        (o.title?.toLowerCase().includes(normalized) ||
          o.parsedDate?.includes(normalized) ||
          o.category?.toLowerCase().includes(normalized))
    );

    if (sealedMatch) {
      return { status: "completed", count: 1, candidates: [sealedMatch] };
    }

    const candidates = all.filter(
      (o) =>
        !o.isSealed &&
        !o.isLocked &&
        (o.title?.toLowerCase().includes(normalized) ||
          o.body?.toLowerCase().includes(normalized) ||
          o.category?.toLowerCase().includes(normalized) ||
          o.parsedDate?.includes(normalized))
    );

    return { status: "completed", count: candidates.length, candidates };
  } catch (err) {
    return {
      status: "failed",
      message: err instanceof Error ? err.message : "Query failed",
    };
  }
}
