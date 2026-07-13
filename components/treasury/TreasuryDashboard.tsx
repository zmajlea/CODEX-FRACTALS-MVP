"use client";

import { useCallback, useEffect, useState } from "react";
import type { TreasuryAccountsResponse } from "@/lib/treasury/types";
import { TreasuryAccountsView } from "@/components/treasury/TreasuryAccountsView";
import { TreasuryManagedByLine } from "@/components/treasury/TreasuryManagedByLine";

export function TreasuryDashboard() {
  const [data, setData] = useState<TreasuryAccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/treasury/accounts");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to load treasury data");
      }
      setData((await res.json()) as TreasuryAccountsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TreasuryAccountsView
      institutions={data?.institutions ?? []}
      transactions={data?.transactions ?? []}
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      onLinked={() => void load()}
      headerExtra={<TreasuryManagedByLine />}
    />
  );
}
