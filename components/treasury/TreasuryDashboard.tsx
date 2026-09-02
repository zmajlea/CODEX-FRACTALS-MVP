"use client";

import { useCallback, useEffect, useState } from "react";
import { useClientGrants } from "@/components/platform/ClientGrantsContext";
import type { TreasuryAccountsResponse } from "@/lib/treasury/types";
import { TreasuryClientCashHero } from "@/components/treasury/TreasuryClientCashHero";
import { TreasuryClientCashTrend } from "@/components/treasury/TreasuryClientCashTrend";
import { TreasuryClientConnections } from "@/components/treasury/TreasuryClientConnections";
import { TreasuryClientDocuments } from "@/components/treasury/TreasuryClientDocuments";
import { TreasuryClientRecommendations } from "@/components/treasury/TreasuryClientRecommendations";
import { TreasuryClientTreasurerStrip } from "@/components/treasury/TreasuryClientTreasurerStrip";
import { ClientReviewView } from "@/components/treasury/ClientReviewView";

type View = "overview" | "review" | "recommendations" | "documents" | "connections";

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
    { id: "review", label: "Review" },
    { id: "recommendations", label: "Recommendations", badge: recUnread },
    { id: "documents", label: "Documents" },
    { id: "connections", label: "Connections" },
  ];

  const srcLine = tenantName
    ? `Managed by your Summit team, from your imported book.`
    : "Managed by your Summit team, from your imported book.";

  return (
    <div className="client-wrap">
      <div
        className="tabs"
        role="tablist"
        aria-label="Your treasury"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`t-${t.id}`}
            aria-selected={view === t.id}
            aria-controls={`p-${t.id}`}
            onClick={() => setView(t.id)}
          >
            {t.label}
            {t.badge ? ` ${t.badge}` : ""}
          </button>
        ))}
      </div>

      <section
        className={`tabpanel${view === "overview" ? " on" : ""}`}
        id="p-overview"
        role="tabpanel"
        aria-labelledby="t-overview"
        hidden={view !== "overview"}
      >
        <h1 className="rh1">Your treasury</h1>
        <p className="rh-src">{srcLine}</p>
        {error ? (
          <p className="panel-note mb-4" style={{ color: "var(--su-neg)" }} role="alert">
            {error}
          </p>
        ) : null}
        <TreasuryClientCashHero
          institutions={data?.institutions ?? []}
          lastSyncedAt={data?.last_synced_at ?? null}
          loading={loading}
        />
        <TreasuryClientTreasurerStrip
          onReviewPending={() => setView("recommendations")}
          onRecommendationsChange={(_recs, unread) => setRecUnread(unread)}
        />
        <TreasuryClientCashTrend />
      </section>

      <section
        className={`tabpanel${view === "review" ? " on" : ""}`}
        id="p-review"
        role="tabpanel"
        aria-labelledby="t-review"
        hidden={view !== "review"}
      >
        <ClientReviewView tenantName={tenantName} />
      </section>

      <section
        className={`tabpanel${view === "recommendations" ? " on" : ""}`}
        id="p-recommendations"
        role="tabpanel"
        aria-labelledby="t-recommendations"
        hidden={view !== "recommendations"}
      >
        <TreasuryClientRecommendations onUnreadChange={setRecUnread} />
      </section>

      <section
        className={`tabpanel${view === "documents" ? " on" : ""}`}
        id="p-documents"
        role="tabpanel"
        aria-labelledby="t-documents"
        hidden={view !== "documents"}
      >
        <h2 className="rh1">Documents</h2>
        <p className="rh-src">Boards and reports your Summit team shared with you.</p>
        <TreasuryClientDocuments />
      </section>

      <section
        className={`tabpanel${view === "connections" ? " on" : ""}`}
        id="p-connections"
        role="tabpanel"
        aria-labelledby="t-connections"
        hidden={view !== "connections"}
      >
        <TreasuryClientConnections
          institutions={data?.institutions ?? []}
          lastSyncedAt={data?.last_synced_at ?? null}
          csvImportedBy={tenantName}
          onLinked={() => void load()}
          onDisconnected={() => void load()}
        />
      </section>
    </div>
  );
}
