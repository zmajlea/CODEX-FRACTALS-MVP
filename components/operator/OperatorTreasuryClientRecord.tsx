"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { BcnContinuityShell } from "@/components/bcn/BcnContinuityShell";
import type { BcnRailGroup } from "@/components/bcn/BcnRail";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";
import { TreasuryConnectionsPanel } from "@/components/operator/treasury/TreasuryConnectionsPanel";
import { TreasuryLedgerPanel } from "@/components/operator/treasury/TreasuryLedgerPanel";
import { TreasuryOverviewTiles } from "@/components/treasury/TreasuryOverviewTiles";
import { TreasuryProfilePanel } from "@/components/operator/treasury/TreasuryProfilePanel";
import { TreasuryRecommendationsPanel } from "@/components/operator/treasury/TreasuryRecommendationsPanel";
import { TreasuryRecordCrumb } from "@/components/operator/treasury/TreasuryRecordCrumb";
import { TreasuryRecordRailBack } from "@/components/operator/treasury/TreasuryRecordRailBack";
import { DraftsRail, type EvidenceNavRequest } from "@/components/operator/treasury/DraftsRail";
import { useOptimisticPick } from "@/components/operator/treasury/useOptimisticPick";
import { TreasuryRulesPanel } from "@/components/operator/treasury/TreasuryRulesPanel";
import {
  TreasuryAnalyticsPanel,
  type AnalyticsView,
} from "@/components/operator/treasury/TreasuryAnalyticsPanel";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { isDemoTenant } from "@/lib/treasury/is-demo-tenant";
import { txQueryParamsToFilters } from "@/lib/treasury/evidence";
import { formatTreasuryAsOf, TREASURY_DISPLAY_LOCALE } from "@/lib/treasury/format";
import { defaultDateRange, periodEnd, periodLabel } from "@/lib/treasury/period-bounds";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type {
  SummaryBucket,
  TreasuryAccountsResponse,
  TreasuryDateRange,
  TreasuryDrillRange,
  TreasuryRuleRow,
  TreasuryTransactionRow,
} from "@/lib/treasury/types";

type Tab =
  | "profile"
  | "overview"
  | "analytics"
  | "transactions"
  | "rules"
  | "recommendations"
  | "connections";

const VALID_TABS: Tab[] = [
  "profile",
  "overview",
  "analytics",
  "transactions",
  "rules",
  "recommendations",
  "connections",
];

function parseInitialTab(value: string | undefined): Tab {
  if (value === "spend-plan" || value === "summary") return "analytics";
  if (value && (VALID_TABS as string[]).includes(value)) {
    return value as Tab;
  }
  return "overview";
}

function parseInitialAnalyticsView(
  tabParam: string | undefined,
  viewParam: string | undefined
): AnalyticsView {
  if (viewParam === "analyzer" || viewParam === "forecast") return viewParam;
  if (tabParam === "spend-plan") return "analyzer";
  return "forecast";
}

type Props = {
  tenantId: string;
  tenantName: string;
  domainSlug: string;
  clientUserId: string;
  clientName: string;
  clientEmail: string;
  grantId: string | null;
  watchNote?: string | null;
  initialTab?: string;
  initialAnalyticsView?: string;
  initialStudyId?: string;
  /** Stage 8 — deep-link into Recommendations draft composer. */
  initialDraftId?: string;
};

const SUMMIT_BRAND = "summit";

function provenanceLine(data: TreasuryAccountsResponse | null): string | null {
  if (!data?.institutions.length) return null;
  const plaid = data.institutions.filter((i) => i.item_id !== "csv-manual");
  const names = plaid.map((i) => i.institution_name).filter(Boolean).join(", ");
  // Spec 35: do not push "Imported from CSV" here — asOfLine already states it with data-through.
  if (plaid.length) {
    return `Synced from Plaid${names ? ` · ${names}` : ""}`;
  }
  return null;
}

function dataThroughLine(data: TreasuryAccountsResponse | null): string | null {
  const dates = (data?.transactions ?? [])
    .map((t) => t.date)
    .filter((d): d is string => Boolean(d))
    .sort();
  if (dates.length === 0) return null;
  return dates[dates.length - 1] ?? null;
}

function formatOverviewThrough(iso: string | null): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  try {
    return new Intl.DateTimeFormat(TREASURY_DISPLAY_LOCALE, {
      dateStyle: "medium",
    }).format(new Date(`${d}T12:00:00`));
  } catch {
    return d;
  }
}

export function OperatorTreasuryClientRecord({
  tenantName,
  domainSlug,
  clientUserId,
  clientName,
  clientEmail,
  grantId,
  watchNote,
  initialTab,
  initialAnalyticsView,
  initialStudyId,
  initialDraftId,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const wordmark = defaultWordmark(SUMMIT_BRAND);
  const [who, setWho] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => parseInitialTab(initialTab));
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>(() =>
    parseInitialAnalyticsView(initialTab, initialAnalyticsView)
  );
  const [focusDraftId, setFocusDraftId] = useState<string | null>(
    () => initialDraftId ?? null
  );
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
  const [openRuleQueueId, setOpenRuleQueueId] = useState<string | null>(null);
  const [basketKey, setBasketKey] = useState(0);
  const [focusTxId, setFocusTxId] = useState<string | null>(null);
  const [seedLedgerFilters, setSeedLedgerFilters] = useState<{
    from?: string;
    to?: string;
    q?: string;
    accountIds?: string[];
    amountMin?: string;
    amountMax?: string;
    amountExact?: string;
    status?: "all" | "needs_label" | "suggested" | "labeled";
  } | null>(null);
  const [focusStudyId, setFocusStudyId] = useState<string | null>(null);

  const bumpBasket = useCallback(() => {
    setBasketKey((k) => k + 1);
  }, []);

  const {
    pick: sharedPick,
    pickTransactions,
    pickNotice,
    clearNotice,
    setNotice,
  } = useOptimisticPick(clientUserId, bumpBasket);

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

  const switchTab = useCallback(
    (next: Tab, opts?: { view?: AnalyticsView }) => {
      setTab(next);
      const view =
        next === "analytics" ? (opts?.view ?? analyticsView) : analyticsView;
      if (next === "analytics" && opts?.view) {
        setAnalyticsView(opts.view);
      }
      const qs = new URLSearchParams({ tab: next });
      if (next === "analytics" && view !== "forecast") {
        qs.set("view", view);
      }
      router.replace(
        `/operator/treasury/clients/${clientUserId}?${qs.toString()}`,
        { scroll: false }
      );
    },
    [analyticsView, clientUserId, router]
  );

  const syncAnalyticsView = useCallback(
    (view: AnalyticsView) => {
      setAnalyticsView(view);
      const qs = new URLSearchParams({ tab: "analytics" });
      if (view !== "forecast") qs.set("view", view);
      router.replace(
        `/operator/treasury/clients/${clientUserId}?${qs.toString()}`,
        { scroll: false }
      );
    },
    [clientUserId, router]
  );

  const demo = isDemoTenant(domainSlug);

  const railGroups: BcnRailGroup[] = useMemo(
    () => [
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
            id: "profile",
            icon: "building",
            label: "Profile",
            active: tab === "profile",
            onClick: () => setTab("profile"),
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
            id: "analytics",
            icon: "money",
            label: "Analytics",
            active: tab === "analytics",
            onClick: () => switchTab("analytics"),
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
    [clientName, tab, needsLabelCount, recUnread, switchTab]
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
    const round2 = (n: number) => Math.round(n * 100) / 100;
    setRuleDraft({
      name: `Rule: ${tx.label}`,
      match_merchant: tx.normalized_merchant ?? tx.merchant_name ?? "",
      assign_label: tx.label ?? "",
      amount_min: round2(abs * 0.8),
      amount_max: round2(abs * 1.2),
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

  async function handleOverviewPick(draftKind: DraftKind, pickable: Pickable) {
    await sharedPick(draftKind, pickable);
  }

  function handleRuleSaved(suggestedCount: number, ruleId: string | null) {
    setRuleDraft(null);
    // Spec 36: stay on Rules; open the new rule’s Suggested queue
    if (ruleId) setOpenRuleQueueId(ruleId);
    setTab("rules");
    setLedgerKey((k) => k + 1);
    if (suggestedCount === 0) {
      setRuleBanner(null);
    }
  }

  function handleOpenRuleQueue(ruleId: string) {
    setOpenRuleQueueId(ruleId);
    setTab("rules");
  }

  function handleNavigateEvidence(nav: EvidenceNavRequest) {
    if (nav.kind === "transaction") {
      setDrillRange(null);
      setSeedLedgerFilters(null);
      setFocusTxId(nav.id);
      setTab("transactions");
      setLedgerKey((k) => k + 1);
      router.replace(
        `/operator/treasury/clients/${clientUserId}?tab=transactions`,
        { scroll: false }
      );
      return;
    }
    if (nav.kind === "txquery") {
      const f = txQueryParamsToFilters(nav.params);
      setDrillRange(null);
      setFocusTxId(null);
      setSeedLedgerFilters({
        from: f.from ?? undefined,
        to: f.to ?? undefined,
        q: f.q ?? undefined,
        accountIds: f.accountIds ?? undefined,
        amountMin: f.amountMin != null ? String(f.amountMin) : undefined,
        amountMax: f.amountMax != null ? String(f.amountMax) : undefined,
        amountExact: f.amountExact != null ? String(f.amountExact) : undefined,
        status:
          f.status === "needs_label" ||
          f.status === "suggested" ||
          f.status === "labeled"
            ? f.status
            : "all",
      });
      setTab("transactions");
      setLedgerKey((k) => k + 1);
      router.replace(
        `/operator/treasury/clients/${clientUserId}?tab=transactions`,
        { scroll: false }
      );
      return;
    }
    if (nav.kind === "study") {
      setFocusStudyId(nav.id);
      setTab("analytics");
      setAnalyticsView("analyzer");
      router.replace(
        `/operator/treasury/clients/${clientUserId}?tab=analytics&view=analyzer&study=${nav.id}`,
        { scroll: false }
      );
      return;
    }
    if (nav.kind === "rule") {
      setOpenRuleQueueId(nav.id);
      setTab("rules");
      router.replace(
        `/operator/treasury/clients/${clientUserId}?tab=rules`,
        { scroll: false }
      );
      return;
    }
    if (nav.kind === "summary_period" || nav.kind === "summary_range") {
      const from =
        typeof nav.params.from === "string" ? nav.params.from : undefined;
      const to = typeof nav.params.to === "string" ? nav.params.to : undefined;
      if (from && to) {
        setDateRange({ preset: "custom", from, to });
      }
      setTab("analytics");
      setAnalyticsView("forecast");
      router.replace(
        `/operator/treasury/clients/${clientUserId}?tab=analytics&view=forecast`,
        { scroll: false }
      );
    }
  }

  const prov = provenanceLine(data);
  const csvOnly =
    !!data?.institutions.some((i) => i.item_id === "csv-manual") &&
    !data?.institutions.some((i) => i.item_id !== "csv-manual");
  const hasBankConnection = !!data?.institutions.some((i) => i.item_id !== "csv-manual");
  const accountCount =
    data?.institutions.reduce((n, inst) => n + (inst.accounts?.length ?? 0), 0) ?? 0;
  const dataThrough = dataThroughLine(data);
  const asOfLine = csvOnly
    ? `Imported from CSV${dataThrough ? ` · data through ${dataThrough}` : ""}`
    : `Last synced ${formatTreasuryAsOf(data?.last_synced_at ?? null)}`;

  const primaryBanksLabel = (() => {
    if (!data?.institutions.length) return null;
    const names = data.institutions
      .map((i) => i.institution_name)
      .filter((n): n is string => Boolean(n));
    return names.length ? names.join("; ") : null;
  })();

  return (
    <BcnContinuityShell
      mode="operator"
      dataBrand={SUMMIT_BRAND}
      dataR1
      wordmark={wordmark}
      homeHref="/operator"
      recordPill={{ primary: clientName, secondary: "Treasury" }}
      who={who}
      keyUnlocked
      railGroups={railGroups}
      railHead={<TreasuryRecordRailBack />}
      onLogout={() => void handleLogout()}
      showBcnSolutionLine
    >
      <div className="view on">
        <TreasuryRecordCrumb
          clientUserId={clientUserId}
          clientName={clientName}
          tab={tab}
        />

        {/* Spec 35: record header = identity only. Sync → Connections; Suspend/Revoke → Profile. */}
        {tab !== "overview" && tab !== "transactions" ? (
          <div className="panel p-4 mb-4">
            <p className="font-medium font-head text-lg">{clientName}</p>
            <p className="text-sm text-codex-muted">{clientEmail}</p>
            {prov ? <p className="text-xs text-codex-muted mt-1">{prov}</p> : null}
            <p className="text-xs text-codex-muted mt-1">{asOfLine}</p>
          </div>
        ) : null}

        {actionMsg ? <p className="panel-note mb-4">{actionMsg}</p> : null}

        {tab === "profile" ? (
          <TreasuryProfilePanel
            clientUserId={clientUserId}
            clientName={clientName}
            clientEmail={clientEmail}
            grantId={grantId}
            busyAction={busyAction}
            onSuspend={() => void suspendAccess()}
            onRevoke={() => void revokeAccess()}
            onResetComplete={() => {
              setActionMsg("Client data reset — record is empty.");
              void load(false);
            }}
            primaryBanks={primaryBanksLabel}
          />
        ) : null}

        {tab === "overview" ? (
          <>
            <div className="hubhead">
              <div>
                <div className="eyebrow">Treasury record</div>
                <h1 className="title">{clientName}</h1>
              </div>
            </div>

            {demo && csvOnly ? (
              <span className="illus">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 3.5 19 6v6c0 4.4-3 7.4-7 8.7C8 19.4 5 16.4 5 12V6l7-2.5Z" />
                </svg>
                Illustrative data, imported from CSV through{" "}
                {formatOverviewThrough(dataThrough ?? data?.last_synced_at ?? null)}
              </span>
            ) : null}

            <TreasuryOverviewTiles
              clientUserId={clientUserId}
              clientName={clientName}
              tenantName={tenantName}
              institutions={data?.institutions ?? []}
              transactions={data?.transactions ?? []}
              lastSyncedAt={data?.last_synced_at ?? null}
              dataThrough={dataThrough}
              needsLabelCount={needsLabelCount}
              accountCount={accountCount}
              csvOnly={csvOnly}
              transactionCount={data?.transaction_count ?? 0}
              watchNote={watchNote}
              onTabSwitch={switchTab}
              onPick={handleOverviewPick}
              rulesRefreshKey={ledgerKey}
            />
          </>
        ) : null}

        {tab === "analytics" ? (
          <TreasuryAnalyticsPanel
            clientUserId={clientUserId}
            demo={demo}
            hasSyncedData={hasSyncedData}
            accountsData={data}
            initialView={analyticsView}
            initialStudyId={focusStudyId ?? initialStudyId}
            clientName={clientName}
            onSelectPeriod={handleSelectPeriod}
            onPick={sharedPick}
            onViewChange={syncAnalyticsView}
          />
        ) : null}

        {tab === "transactions" ? (
          <TreasuryLedgerPanel
            key={ledgerKey}
            clientUserId={clientUserId}
            demo={demo}
            institutions={data?.institutions ?? []}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            drillRange={drillRange}
            onClearDrill={handleClearDrill}
            hasSyncedData={hasSyncedData}
            onMakeRule={handleMakeRule}
            onNeedsLabelCount={setNeedsLabelCount}
            onOpenRuleQueue={handleOpenRuleQueue}
            ruleBanner={ruleBanner}
            onDismissBanner={() => setRuleBanner(null)}
            onPick={sharedPick}
            onPickTransactions={pickTransactions}
            focusTxId={focusTxId}
            onFocusTxConsumed={() => setFocusTxId(null)}
            seedFilters={seedLedgerFilters}
            onSeedFiltersConsumed={() => setSeedLedgerFilters(null)}
          />
        ) : null}

        {tab === "rules" ? (
          <TreasuryRulesPanel
            clientUserId={clientUserId}
            demo={demo}
            draftRule={ruleDraft}
            onClearDraft={() => setRuleDraft(null)}
            onGoToTransactions={() => setTab("transactions")}
            onRuleSaved={handleRuleSaved}
            openRuleQueueId={openRuleQueueId}
            onOpenRuleQueueConsumed={() => setOpenRuleQueueId(null)}
            onPick={sharedPick}
          />
        ) : null}

        {tab === "recommendations" ? (
          <TreasuryRecommendationsPanel
            clientUserId={clientUserId}
            clientName={clientName}
            institutions={data?.institutions ?? []}
            operatorName={who}
            onUnreadChange={setRecUnread}
            onPick={sharedPick}
            onBasketChanged={bumpBasket}
            initialDraftId={focusDraftId}
            onDraftDeepLinkConsumed={() => {
              setFocusDraftId(null);
              router.replace(
                `/operator/treasury/clients/${clientUserId}?tab=recommendations`,
                { scroll: false }
              );
            }}
          />
        ) : null}

        {tab === "connections" ? (
          <TreasuryConnectionsPanel
            clientUserId={clientUserId}
            clientEmail={clientEmail}
            institutions={data?.institutions ?? []}
            lastSyncedAt={data?.last_synced_at ?? null}
            syncing={syncing}
            showSyncFromBank={hasBankConnection}
            onSync={() => void load(true)}
            onImported={() => void load(false)}
            onPick={sharedPick}
          />
        ) : null}
      </div>

      <DraftsRail
        clientUserId={clientUserId}
        clientName={clientName}
        refreshKey={basketKey}
        pickNotice={pickNotice}
        onClearPickNotice={clearNotice}
        onSetPickNotice={setNotice}
        onOpenDraft={(draftId) => {
          setTab("recommendations");
          setFocusDraftId(draftId);
          router.replace(
            `/operator/treasury/clients/${clientUserId}?tab=recommendations&draft=${draftId}`,
            { scroll: false }
          );
        }}
        onNavigateEvidence={handleNavigateEvidence}
      />
    </BcnContinuityShell>
  );
}
