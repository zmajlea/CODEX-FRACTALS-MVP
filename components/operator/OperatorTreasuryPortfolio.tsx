"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { BcnContinuityShell } from "@/components/bcn/BcnContinuityShell";
import { BcnIcon } from "@/components/bcn/BcnIcon";
import type { BcnRailGroup } from "@/components/bcn/BcnRail";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";
import { InviteClientModal } from "@/components/platform/InviteClientModal";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { formatTreasuryMoney } from "@/components/treasury/TreasuryAccountsView";

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
};

type ActiveModule = {
  slug: string;
  name: string;
  status: string;
};

type Props = {
  tenantId: string;
  tenantName: string;
  credits: number;
  initialClients: OperatorTreasuryClientRow[];
  treasurySeatCost?: number;
};

function formatAsOf(iso: string | null): string {
  if (!iso) return "Not synced yet";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function primaryCashDisplay(row: OperatorTreasuryClientRow): string {
  const entries = Object.entries(row.total_cash_by_currency ?? {});
  if (entries.length === 1) {
    return formatTreasuryMoney(entries[0]![1], entries[0]![0]);
  }
  if (entries.length > 1) {
    return entries
      .map(([cur, amt]) => formatTreasuryMoney(amt, cur))
      .join(" · ");
  }
  return formatTreasuryMoney(row.total_cash, "USD");
}

export function OperatorTreasuryPortfolio({
  tenantId,
  tenantName,
  credits,
  initialClients,
  treasurySeatCost = 1,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const theme = useBcnThemeOptional();
  const wordmark = theme.wordmark ?? defaultWordmark(theme.dataBrand);
  const [clients, setClients] = useState(initialClients);
  const [modules, setModules] = useState<ActiveModule[]>([]);
  const [who, setWho] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [loading, setLoading] = useState(false);

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
    () => [
      {
        label: "Workspace",
        items: [
          {
            id: "treasury-clients",
            icon: "grid",
            label: "Treasury clients",
            active: true,
          },
          {
            id: "operator-home",
            icon: "people",
            label: "Operator home",
            href: "/operator",
          },
        ],
      },
    ],
    []
  );

  const seatsUsed = clients.length;

  return (
    <>
      <BcnContinuityShell
        mode="operator"
        dataBrand={theme.dataBrand}
        wordmark={wordmark}
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
              <div className="eyebrow">{tenantName}</div>
              <h1 className="title">Your Treasury clients</h1>
              <p className="text-sm text-codex-muted mt-1">
                {seatsUsed} active client{seatsUsed === 1 ? "" : "s"} · cache-only
                balances (as-of dates shown per client)
              </p>
            </div>
            <div className="mh-meta">
              <div className="big">{credits}</div>
              <div className="sub">credits remaining</div>
            </div>
          </div>

          <div className="panel mb-4 p-4 text-sm text-codex-muted">
            Treasury seats used: <strong>{seatsUsed}</strong> · Credits remaining:{" "}
            <strong>{credits}</strong>
            {treasurySeatCost > 1 ? (
              <> · {treasurySeatCost} credits per treasury seat</>
            ) : null}
          </div>

          <div className="nextstep mb-6">
            <span className="ns-ic">
              <BcnIcon name="inbox" />
            </span>
            <div>
              <div className="ns-k">Manage access</div>
              <div className="ns-t">Invite a client to Treasury</div>
            </div>
            <span className="grow" />
            <button
              type="button"
              className="btn"
              disabled={credits < treasurySeatCost || treasuryModules.length === 0}
              onClick={() => setInviteOpen(true)}
            >
              Invite client ›
            </button>
          </div>

          {loading ? <p className="panel-note">Refreshing…</p> : null}

          {clients.length === 0 ? (
            <div className="panel p-8 text-center">
              <p className="text-codex-muted mb-4">
                No Treasury clients yet. Invite a client to link their banks.
              </p>
              <button
                type="button"
                className="btn"
                disabled={credits < treasurySeatCost}
                onClick={() => setInviteOpen(true)}
              >
                Invite first client
              </button>
            </div>
          ) : (
            <div className="cards3">
              {clients.map((row) => (
                <article key={row.grant_id} className="panel p-5 flex flex-col gap-3">
                  <div>
                    <h2 className="font-head text-lg">{row.client_name}</h2>
                    <p className="text-sm text-codex-muted">{row.client_email}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-codex-muted">
                      Aggregate cash
                    </p>
                    <p className="text-2xl tabular-nums font-medium">
                      {primaryCashDisplay(row)}
                    </p>
                  </div>
                  <p className="text-sm text-codex-muted">
                    {row.institution_count} institution
                    {row.institution_count === 1 ? "" : "s"} · {row.account_count} account
                    {row.account_count === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-codex-muted">
                    As of {formatAsOf(row.last_synced_at)}
                  </p>
                  <span className="inline-flex">
                    <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 uppercase tracking-wide">
                      {row.status}
                    </span>
                  </span>
                  <Link
                    href={`/operator/treasury/clients/${row.client_user_id}`}
                    className="btn btn-secondary mt-auto self-start"
                  >
                    Open ›
                  </Link>
                </article>
              ))}
            </div>
          )}
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
