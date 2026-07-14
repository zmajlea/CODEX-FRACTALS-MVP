"use client";

import { useCallback, useEffect, useState } from "react";
import { useClientGrants } from "@/components/platform/ClientGrantsContext";
import type { TreasuryAccountsResponse } from "@/lib/treasury/types";
import { TreasuryAccountsView } from "@/components/treasury/TreasuryAccountsView";
import { TreasuryClientCashHero } from "@/components/treasury/TreasuryClientCashHero";
import { TreasuryClientCashTrend } from "@/components/treasury/TreasuryClientCashTrend";
import { TreasuryClientConnections } from "@/components/treasury/TreasuryClientConnections";
import { TreasuryClientRecommendations } from "@/components/treasury/TreasuryClientRecommendations";
import { TreasuryClientTreasurerStrip } from "@/components/treasury/TreasuryClientTreasurerStrip";
import { formatTreasuryAsOf } from "@/lib/treasury/format";

type View = "overview" | "recommendations" | "connections";

export function TreasuryDashboard() {
  const { grants, activeGrantId } = useClientGrants();
  const active =
    grants.find((g) => g.id === activeGrantId) ??
    grants.find((g) => g.modules?.slug === "treasury") ??
    grants[0];
  const tenantName = active?.tenants?.name ?? null;

  const [view, setView] = useState<View>("overview");
  const [recUnread, setRecUnread] = useState(0);
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

  const tabs: { id: View; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "recommendations", label: "Recommendations", badge: recUnread },
    { id: "connections", label: "Connections" },
  ];

  const metaLine = tenantName
    ? `Managed by ${tenantName} · ${
        data?.last_synced_at
          ? `bank feed refreshed ${formatTreasuryAsOf(data.last_synced_at)}`
          : "from your imported book"
      }`
    : data?.last_synced_at
      ? `Bank feed refreshed ${formatTreasuryAsOf(data.last_synced_at)}`
      : "From your imported book";

  return (
    <div className="treasury-page p-8">
      <header className="mb-6">
        <p className="eyebrow">Treasury</p>
        <h1 className="title">Your treasury</h1>
        <p className="treasury-meta mt-2">{metaLine}</p>
      </header>

      <nav className="treasury-tabs choices" aria-label="Treasury views">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`seg${view === t.id ? " on" : ""}`}
            onClick={() => setView(t.id)}
          >
            {t.label}
            {t.badge ? <span className="treasury-tab-badge">{t.badge}</span> : null}
          </button>
        ))}
      </nav>

      {view === "overview" ? (
        <>
          {error ? (
            <p className="panel-note mb-4" style={{ color: "var(--su-neg)" }} role="alert">
              {error}
            </p>
          ) : null}
          <TreasuryClientCashHero
            institutions={data?.institutions ?? []}
            lastSyncedAt={data?.last_synced_at ?? null}
          />
          <TreasuryClientTreasurerStrip
            onReviewPending={() => setView("recommendations")}
            onRecommendationsChange={(_recs, unread) => setRecUnread(unread)}
          />
          <TreasuryClientCashTrend />
          <TreasuryAccountsView
            embedded
            institutions={data?.institutions ?? []}
            transactions={data?.transactions ?? []}
            loading={loading}
            error={error}
            hideTotals
            transactionCount={data?.transaction_count}
            showConnectButton={false}
            onRefresh={() => void load()}
          />
        </>
      ) : null}

      {view === "recommendations" ? (
        <TreasuryClientRecommendations onUnreadChange={setRecUnread} />
      ) : null}

      {view === "connections" ? (
        <TreasuryClientConnections
          institutions={data?.institutions ?? []}
          lastSyncedAt={data?.last_synced_at ?? null}
          csvImportedBy={tenantName}
          onLinked={() => void load()}
          onDisconnected={() => void load()}
        />
      ) : null}
    </div>
  );
}
