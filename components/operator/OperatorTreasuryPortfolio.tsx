"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { BcnContinuityShell } from "@/components/bcn/BcnContinuityShell";
import type { BcnRailGroup } from "@/components/bcn/BcnRail";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";
import { InviteClientModal } from "@/components/platform/InviteClientModal";
import { TreasuryPortfolioClientCard } from "@/components/operator/treasury/TreasuryPortfolioClientCard";
import { treasuryPortfolioRailGroups } from "@/components/operator/treasury/treasuryPortfolioRail";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { isDemoTenant } from "@/lib/treasury/is-demo-tenant";

export type OperatorTreasuryClientRow = {
  grant_id: string;
  client_user_id: string;
  client_email: string;
  client_name: string;
  status: string;
  institution_count: number;
  account_count: number;
  total_cash: number;
  total_cash_by_currency: Record<string, number>;
  last_synced_at: string | null;
  needs_label_count?: number;
  industry?: string | null;
  next_note?: string | null;
  watch_note?: string | null;
  attention_reason?: string | null;
};

type ActiveModule = {
  slug: string;
  name: string;
  status: string;
};

type PortfolioView = "cards" | "list";

const VIEW_STORAGE_KEY = "summit.portfolioView";

type Props = {
  tenantId: string;
  tenantName: string;
  domainSlug: string;
  credits: number;
  initialClients: OperatorTreasuryClientRow[];
  treasurySeatCost?: number;
};

function readStoredView(): PortfolioView {
  if (typeof window === "undefined") return "cards";
  const v = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return v === "list" ? "list" : "cards";
}

export function OperatorTreasuryPortfolio({
  tenantId,
  tenantName,
  domainSlug,
  credits,
  initialClients,
  treasurySeatCost = 1,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [clients, setClients] = useState(initialClients);
  const [modules, setModules] = useState<ActiveModule[]>([]);
  const [who, setWho] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inboxUnread, setInboxUnread] = useState(0);
  const [view, setView] = useState<PortfolioView>("cards");

  const demo = isDemoTenant(domainSlug);

  useEffect(() => {
    setView(readStoredView());
  }, []);

  const setPortfolioView = useCallback((next: PortfolioView) => {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("list_operator_treasury_clients", {
      p_tenant_id: tenantId,
    });
    if (Array.isArray(data)) {
      setClients(data as OperatorTreasuryClientRow[]);
    }
    setLoading(false);
  }, [supabase, tenantId]);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/operator/treasury/inbox?tenantId=${tenantId}`);
      if (res.ok) {
        const data = (await res.json()) as { unreadCount?: number };
        if (typeof data.unreadCount === "number") setInboxUnread(data.unreadCount);
      }
    })();
  }, [tenantId]);

  useEffect(() => {
    void (async () => {
      const { data: moduleData } = await supabase.rpc("list_operator_modules", {
        p_tenant_id: tenantId,
      });
      if (Array.isArray(moduleData)) {
        setModules(moduleData as ActiveModule[]);
      }
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
  }, [supabase, tenantId]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push(PORTAL_LOGIN);
  }, [router, supabase]);

  const treasuryModules = useMemo(
    () => modules.filter((m) => m.slug === "treasury"),
    [modules]
  );

  const railGroups: BcnRailGroup[] = useMemo(
    () => treasuryPortfolioRailGroups({ inboxUnread, active: "portfolio" }),
    [inboxUnread]
  );

  const attentionClients = useMemo(
    () =>
      clients.filter((c) => {
        const reason = c.attention_reason?.trim();
        return Boolean(reason);
      }),
    [clients]
  );

  // R1 — adding clients is off during testing (docs tell Tim; UI must match).
  const inviteDisabled = true;
  const inviteOffTitle = "Adding clients is off during R1 testing";

  const activeCount = clients.length;

  return (
    <>
      <BcnContinuityShell
        mode="operator"
        dataBrand="summit"
        dataR1
        wordmark={defaultWordmark("summit")}
        homeHref="/operator"
        recordPill={{
          primary: "Treasury workspace",
          secondary: tenantName,
        }}
        who={who}
        keyUnlocked
        railGroups={railGroups}
        onLogout={() => void handleLogout()}
        showBcnSolutionLine
      >
        <section className="view on" aria-label="Operator treasury portfolio">
          <div className="hubhead">
            <div>
              <div className="eyebrow">Your firm</div>
              <h1 className="title">Portfolio Dashboard</h1>
            </div>
            <div className="ph-right">
              <button
                type="button"
                className="btn"
                disabled={inviteDisabled}
                aria-disabled={inviteDisabled}
                title={inviteDisabled ? inviteOffTitle : undefined}
                onClick={() => {
                  if (inviteDisabled) return;
                  setInviteOpen(true);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ width: 15, height: 15 }}
                  aria-hidden
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New client
              </button>
              <div className="pv-toggle" role="group" aria-label="View">
                <button
                  type="button"
                  className={`pv-btn${view === "cards" ? " on" : ""}`}
                  aria-pressed={view === "cards"}
                  onClick={() => setPortfolioView("cards")}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
                    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
                    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
                    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
                  </svg>
                  Cards
                </button>
                <button
                  type="button"
                  className={`pv-btn${view === "list" ? " on" : ""}`}
                  aria-pressed={view === "list"}
                  onClick={() => setPortfolioView("list")}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
                    <path d="M14 3.5V8h4" />
                  </svg>
                  List
                </button>
              </div>
              <div className="mh-meta">
                <div className="big num">{activeCount}</div>
                <div className="sub">Active clients</div>
              </div>
            </div>
          </div>

          {demo ? (
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
              Illustrative data, from the three sample books
            </span>
          ) : null}

          {attentionClients.length > 0 ? (
            <div className="su-attn">
              <span className="su-attn-ic">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 3.5c2 3 5 4.5 5 8.5a5 5 0 0 1-10 0c0-1.6.6-2.7 1.4-3.7.3 1 .9 1.7 1.8 2 .2-2.8 1-4.9.8-6.8Z" />
                </svg>
              </span>
              <div className="su-attn-b">
                <b>
                  {attentionClients.length} client{attentionClients.length === 1 ? "" : "s"}{" "}
                  {attentionClients.length === 1 ? "needs" : "need"} attention
                </b>
                <span>
                  {attentionClients
                    .map((c) => `${c.client_name}, ${(c.attention_reason?.trim() ?? "").toLowerCase()}`)
                    .join(". ")}
                  .
                </span>
              </div>
            </div>
          ) : null}

          {loading ? <p className="panel-note">Refreshing…</p> : null}

          <div
            className="clgrid"
            style={view === "list" ? { gridTemplateColumns: "1fr" } : undefined}
          >
            {clients.map((row) => (
              <TreasuryPortfolioClientCard key={row.grant_id} row={row} demo={demo} />
            ))}
            <button
              type="button"
              className="addcard"
              disabled={inviteDisabled}
              aria-disabled={inviteDisabled}
              title={inviteDisabled ? inviteOffTitle : undefined}
              onClick={() => {
                if (inviteDisabled) return;
                setInviteOpen(true);
              }}
            >
              <span className="ac-plus">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className="ac-t">New client record</span>
              <span className="ac-s">Create a record and assign it to you</span>
            </button>
          </div>

          {demo ? (
            <p className="meta" style={{ marginTop: 18 }}>
              FFM Demo&apos;s record is built as the instrument in this slice (Open record). The
              other clients show their real portfolio figures; their records open the same pattern
              with their own data in production.
            </p>
          ) : null}
        </section>
      </BcnContinuityShell>

      <InviteClientModal
        open={inviteOpen}
        tenantId={tenantId}
        firmName={tenantName}
        credits={credits}
        modules={treasuryModules.length > 0 ? treasuryModules : modules}
        onClose={() => setInviteOpen(false)}
        onProvisioned={() => {
          setInviteOpen(false);
          void load();
        }}
      />
    </>
  );
}
