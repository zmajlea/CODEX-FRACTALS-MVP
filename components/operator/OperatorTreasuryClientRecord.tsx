"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { BcnContinuityShell } from "@/components/bcn/BcnContinuityShell";
import type { BcnRailGroup } from "@/components/bcn/BcnRail";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";
import { TreasuryAccountsView } from "@/components/treasury/TreasuryAccountsView";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import type { TreasuryAccountsResponse } from "@/lib/treasury/types";

type Props = {
  tenantId: string;
  tenantName: string;
  clientUserId: string;
  clientName: string;
  clientEmail: string;
  grantId: string | null;
};

export function OperatorTreasuryClientRecord({
  tenantId,
  tenantName,
  clientUserId,
  clientName,
  clientEmail,
  grantId,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const theme = useBcnThemeOptional();
  const wordmark = theme.wordmark ?? defaultWordmark(theme.dataBrand);
  const [who, setWho] = useState<string | null>(null);
  const [data, setData] = useState<TreasuryAccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const apiUrl = `/api/operator/treasury/clients/${clientUserId}/accounts`;

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiUrl}${refresh ? "?refresh=1" : ""}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Failed to load treasury data");
        }
        setData((await res.json()) as TreasuryAccountsResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
        if (!refresh) setData(null);
      } finally {
        setLoading(false);
      }
    },
    [apiUrl]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

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
        label: "Workspace",
        items: [
          {
            id: "treasury-portfolio",
            icon: "grid",
            label: "Treasury clients",
            href: "/operator/treasury",
          },
          {
            id: "client-record",
            icon: "people",
            label: clientName,
            active: true,
          },
        ],
      },
    ],
    [clientName]
  );

  async function suspendAccess() {
    if (!grantId) return;
    if (!confirm(`Suspend Treasury access for ${clientName}? Their own view will be frozen too.`)) {
      return;
    }
    setBusyAction("suspend");
    setActionMsg(null);
    const { error: rpcErr } = await supabase.rpc("suspend_operator_client_access", {
      p_grant_id: grantId,
    });
    if (rpcErr) setActionMsg(rpcErr.message);
    else {
      setActionMsg("Access suspended.");
      router.push("/operator/treasury");
    }
    setBusyAction(null);
  }

  async function revokeAccess() {
    if (!grantId) return;
    if (
      !confirm(
        `Revoke Treasury access for ${clientName}? They will no longer reach this module.`
      )
    ) {
      return;
    }
    setBusyAction("revoke");
    setActionMsg(null);
    const { error: rpcErr } = await supabase.rpc("revoke_operator_client_access", {
      p_grant_id: grantId,
    });
    if (rpcErr) setActionMsg(rpcErr.message);
    else {
      setActionMsg("Access revoked.");
      router.push("/operator/treasury");
    }
    setBusyAction(null);
  }

  return (
    <BcnContinuityShell
      mode="operator"
      dataBrand={theme.dataBrand}
      wordmark={wordmark}
      homeHref="/operator"
      recordPill={{
        primary: "Client record",
        secondary: clientName,
      }}
      who={who}
      keyUnlocked
      railGroups={railGroups}
      onLogout={() => void handleLogout()}
      showBcnSolutionLine
    >
      <div className="view on">
        <nav className="text-sm text-codex-muted mb-4">
          <Link href="/operator/treasury" className="hover:text-ink">
            Your clients
          </Link>
          <span className="mx-2">›</span>
          <span className="text-ink">{clientName}</span>
        </nav>

        <div className="panel p-4 mb-6 flex flex-wrap gap-3 items-center justify-between">
          <div>
            <p className="font-medium">{clientName}</p>
            <p className="text-sm text-codex-muted">{clientEmail}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              className="btn btn-secondary"
              href={`mailto:${clientEmail}?subject=Please%20reconnect%20your%20bank&body=Hi%20${encodeURIComponent(clientName)},%0A%0APlease%20log%20in%20and%20reconnect%20your%20bank%20in%20Treasury.`}
            >
              Request (re)connect
            </a>
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

        <TreasuryAccountsView
          institutions={data?.institutions ?? []}
          transactions={data?.transactions ?? []}
          loading={loading}
          error={error}
          readOnly
          title={`${clientName}'s accounts`}
          subtitle={`Managed under ${tenantName}. Read-only operator view.`}
          showConnectButton={false}
          onRefresh={() => void load(true)}
        />
      </div>
    </BcnContinuityShell>
  );
}
