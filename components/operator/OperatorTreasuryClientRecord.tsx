"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { BcnContinuityShell } from "@/components/bcn/BcnContinuityShell";
import type { BcnRailGroup } from "@/components/bcn/BcnRail";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";
import { TreasuryAccountsView } from "@/components/treasury/TreasuryAccountsView";
import { TreasuryConnectionsPanel } from "@/components/operator/treasury/TreasuryConnectionsPanel";
import { TreasuryLedgerPanel } from "@/components/operator/treasury/TreasuryLedgerPanel";
import { TreasuryOverviewTiles } from "@/components/treasury/TreasuryOverviewTiles";
import { TreasuryRecommendationsPanel } from "@/components/operator/treasury/TreasuryRecommendationsPanel";
import { TreasuryRulesPanel } from "@/components/operator/treasury/TreasuryRulesPanel";
import { TreasurySummaryPanel } from "@/components/operator/treasury/TreasurySummaryPanel";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { formatTreasuryAsOf } from "@/lib/treasury/format";
import { defaultDateRange, periodEnd, periodLabel } from "@/lib/treasury/period-bounds";
import type {
  SummaryBucket,
  TreasuryAccountsResponse,
  TreasuryDateRange,
  TreasuryDrillRange,
  TreasuryRuleRow,
  TreasuryTransactionRow,
} from "@/lib/treasury/types";

type Tab =
  | "overview"
  | "summary"
  | "transactions"
  | "rules"
  | "recommendations"
  | "connections";

const VALID_TABS: Tab[] = [
  "overview",
  "summary",
  "transactions",
  "rules",
  "recommendations",
  "connections",
];

function parseInitialTab(value: string | undefined): Tab {
  if (value && (VALID_TABS as string[]).includes(value)) {
    return value as Tab;
  }
  return "overview";
}

type Props = {
  tenantId: string;
  tenantName: string;
  clientUserId: string;
  clientName: string;
  clientEmail: string;
  grantId: string | null;
  initialTab?: string;
};

const SUMMIT_BRAND = "summit";

function provenanceLine(data: TreasuryAccountsResponse | null): string | null {
  if (!data?.institutions.length) return null;
  const plaid = data.institutions.filter((i) => i.item_id !== "csv-manual");
  const csv = data.institutions.find((i) => i.item_id === "csv-manual");
  const parts: string[] = [];
  if (plaid.length) {
    const names = plaid.map((i) => i.institution_name).filter(Boolean).join(", ");
    parts.push(`Synced from Plaid${names ? ` · ${names}` : ""}`);
  }
  if (csv) parts.push("Imported from CSV");
  return parts.join(" · ") || null;
}

export function OperatorTreasuryClientRecord({
  tenantName,
  clientUserId,
  clientName,
  clientEmail,
  grantId,
  initialTab,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const wordmark = defaultWordmark(SUMMIT_BRAND);
  const [who, setWho] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => parseInitialTab(initialTab));
  const [recUnread, setRecUnread] = useState(0);
  const [data, setData] = useState<TreasuryAccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<TreasuryDateRange>(() => defaultDateRange());
  const [savedDateRange, setSavedDateRange] = useState<TreasuryDateRange>(() =>
    defaultDateRange()
  );
  const [drillRange, setDrillRange] = useState<TreasuryDrillRange | null>(null);
  const [ruleDraft, setRuleDraft] = useState<Partial<TreasuryRuleRow> | null>(null);
  const [ruleBanner, setRuleBanner] = useState<string | null>(null);
  const [needsLabelCount, setNeedsLabelCount] = useState(0);
  const [ledgerKey, setLedgerKey] = useState(0);

  const apiUrl = `/api/operator/treasury/clients/${clientUserId}/accounts`;
  const hasSyncedData = (data?.transaction_count ?? 0) > 0;

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setSyncing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiUrl}${refresh ? "?refresh=1" : ""}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Failed to load treasury data");
        }
        const json = (await res.json()) as TreasuryAccountsResponse;
        setData(json);
        setLedgerKey((k) => k + 1);
        if (json.sync_triggered && refresh) {
          setActionMsg("Sync complete.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
        if (!refresh) setData(null);
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    },
    [apiUrl]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    void (async () => {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/transactions?limit=1`
      );
      if (res.ok) {
        const body = (await res.json()) as { needsLabelCount?: number };
        if (typeof body.needsLabelCount === "number") {
          setNeedsLabelCount(body.needsLabelCount);
        }
      }
    })();
  }, [clientUserId, ledgerKey]);

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const display =
          (typeof user.user_metadata?.full_name === "string" &&
            user.user_metadata.full_name.trim()) ||
          user.email?.split("@")[0] ||
          "Operator";
        setWho(display);
      }
    })();
  }, [supabase]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push(PORTAL_LOGIN);
  }, [router, supabase]);

  const railGroups: BcnRailGroup[] = useMemo(
    () => [
      {
        label: "Portfolio",
        items: [
          {
            id: "treasury-inbox",
            icon: "inbox",
            label: "Inbox",
            href: "/operator/treasury/inbox",
          },
          {
            id: "treasury-portfolio",
            icon: "grid",
            label: "Portfolio Dashboard",
            href: "/operator/treasury",
          },
        ],
      },
      {
        label: `${clientName} record`,
        reveal: "unlocked",
        items: [
          {
            id: "overview",
            icon: "home",
            label: "Overview",
            active: tab === "overview",
            onClick: () => setTab("overview"),
          },
          {
            id: "connections",
            icon: "share",
            label: "Connections",
            active: tab === "connections",
            onClick: () => setTab("connections"),
          },
          {
            id: "transactions",
            icon: "doc",
            label: "Transactions",
            active: tab === "transactions",
            badge: needsLabelCount,
            onClick: () => setTab("transactions"),
          },
          {
            id: "rules",
            icon: "pen",
            label: "Rules",
            active: tab === "rules",
            onClick: () => setTab("rules"),
          },
          {
            id: "summary",
            icon: "money",
            label: "Summary",
            active: tab === "summary",
            onClick: () => setTab("summary"),
          },
          {
            id: "recommendations",
            icon: "pen",
            label: "Recommendations",
            active: tab === "recommendations",
            badge: recUnread,
            onClick: () => setTab("recommendations"),
          },
        ],
      },
    ],
    [clientName, tab, needsLabelCount, recUnread]
  );

  async function suspendAccess() {
    if (!grantId) return;
    if (!confirm(`Suspend Treasury access for ${clientName}?`)) return;
    setBusyAction("suspend");
    const { error: rpcErr } = await supabase.rpc("suspend_operator_client_access", {
      p_grant_id: grantId,
    });
    if (rpcErr) setActionMsg(rpcErr.message);
    else router.push("/operator/treasury");
    setBusyAction(null);
  }

  async function revokeAccess() {
    if (!grantId) return;
    if (!confirm(`Revoke Treasury access for ${clientName}?`)) return;
    setBusyAction("revoke");
    const { error: rpcErr } = await supabase.rpc("revoke_operator_client_access", {
      p_grant_id: grantId,
    });
    if (rpcErr) setActionMsg(rpcErr.message);
    else router.push("/operator/treasury");
    setBusyAction(null);
  }

  function handleMakeRule(tx: TreasuryTransactionRow) {
    const abs = Math.abs(Number(tx.amount));
    setRuleDraft({
      name: `Rule: ${tx.label}`,
      match_merchant: tx.normalized_merchant ?? tx.merchant_name ?? "",
      assign_label: tx.label ?? "",
      amount_min: abs * 0.8,
      amount_max: abs * 1.2,
      direction: tx.direction ?? undefined,
      source_transaction_id: tx.id,
    });
    setTab("rules");
  }

  function handleSelectPeriod(bucket: SummaryBucket, periodStart: string) {
    const end = periodEnd(bucket, periodStart);
    setSavedDateRange(dateRange);
    setDrillRange({
      from: periodStart,
      to: end,
      label: periodLabel(bucket, periodStart),
    });
    setTab("transactions");
  }

  function handleClearDrill() {
    setDrillRange(null);
    setDateRange(savedDateRange);
  }

  function handleRuleSaved(suggestedCount: number) {
    setRuleDraft(null);
    setRuleBanner(
      suggestedCount > 0
        ? `Rule found ${suggestedCount} similar transaction${suggestedCount === 1 ? "" : "s"} — review below.`
        : "Rule saved. No matching unlabeled transactions in the current data."
    );
    setTab("transactions");
    setLedgerKey((k) => k + 1);
  }

  const prov = provenanceLine(data);

  return (
    <BcnContinuityShell
      mode="operator"
      dataBrand={SUMMIT_BRAND}
      wordmark={wordmark}
      homeHref="/operator"
      recordPill={{ primary: clientName, secondary: "Treasury" }}
      who={who}
      keyUnlocked
      railGroups={railGroups}
      onLogout={() => void handleLogout()}
      showBcnSolutionLine
    >
      <div className="view on">
        <nav className="text-sm text-codex-muted mb-4">
          <Link href="/operator/treasury" className="hover:text-ink">
            Portfolio Dashboard
          </Link>
          <span className="mx-2">›</span>
          <span className="text-ink">{clientName}</span>
        </nav>

        <div className="panel p-4 mb-4 flex flex-wrap gap-3 items-center justify-between">
          <div>
            <p className="font-medium font-head text-lg">{clientName}</p>
            <p className="text-sm text-codex-muted">{clientEmail}</p>
            {prov ? <p className="text-xs text-codex-muted mt-1">{prov}</p> : null}
            <p className="text-xs text-codex-muted mt-1">
              Last synced {formatTreasuryAsOf(data?.last_synced_at ?? null)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={syncing || loading}
              onClick={() => void load(true)}
            >
              {syncing ? "Syncing…" : "Sync from bank"}
            </button>
            {grantId ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busyAction !== null}
                  onClick={() => void suspendAccess()}
                >
                  Suspend
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busyAction !== null}
                  onClick={() => void revokeAccess()}
                >
                  Revoke
                </button>
              </>
            ) : null}
          </div>
        </div>

        {actionMsg ? <p className="panel-note mb-4">{actionMsg}</p> : null}

        {tab === "overview" ? (
          <>
            <TreasuryOverviewTiles
              institutions={data?.institutions ?? []}
              lastSyncedAt={data?.last_synced_at ?? null}
              needsLabelCount={needsLabelCount}
              onNeedsReviewClick={() => setTab("transactions")}
              sourceCount={data?.institutions.length ?? 0}
              transactionCount={data?.transaction_count}
            />
            <TreasuryAccountsView
              institutions={data?.institutions ?? []}
              transactions={data?.transactions ?? []}
              loading={loading}
              error={error}
              readOnly
              hideTotals
              title={`${clientName}'s accounts`}
              subtitle={`Managed under ${tenantName}. Read-only operator view.`}
              showConnectButton={false}
            />
          </>
        ) : null}

        {tab === "summary" ? (
          <TreasurySummaryPanel
            clientUserId={clientUserId}
            hasSyncedData={hasSyncedData}
            onSelectPeriod={handleSelectPeriod}
          />
        ) : null}

        {tab === "transactions" ? (
          <TreasuryLedgerPanel
            key={ledgerKey}
            clientUserId={clientUserId}
            institutions={data?.institutions ?? []}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            drillRange={drillRange}
            onClearDrill={handleClearDrill}
            hasSyncedData={hasSyncedData}
            onMakeRule={handleMakeRule}
            onNeedsLabelCount={setNeedsLabelCount}
            ruleBanner={ruleBanner}
            onDismissBanner={() => setRuleBanner(null)}
          />
        ) : null}

        {tab === "rules" ? (
          <TreasuryRulesPanel
            clientUserId={clientUserId}
            draftRule={ruleDraft}
            onClearDraft={() => setRuleDraft(null)}
            onGoToTransactions={() => setTab("transactions")}
            onRuleSaved={handleRuleSaved}
          />
        ) : null}

        {tab === "recommendations" ? (
          <TreasuryRecommendationsPanel
            clientUserId={clientUserId}
            institutions={data?.institutions ?? []}
            operatorName={who}
            onUnreadChange={setRecUnread}
          />
        ) : null}

        {tab === "connections" ? (
          <TreasuryConnectionsPanel
            clientUserId={clientUserId}
            clientEmail={clientEmail}
            institutions={data?.institutions ?? []}
            lastSyncedAt={data?.last_synced_at ?? null}
            syncing={syncing}
            onSync={() => void load(true)}
            onImported={() => void load(false)}
          />
        ) : null}
      </div>
    </BcnContinuityShell>
  );
}
