"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { ModuleDemoFromSlug } from "@/components/platform/ModuleDemoCard";
import {
  ClientInviteTable,
  type ClientInviteRow,
} from "@/components/platform/ClientInviteTable";
import {
  OperatorClientsTable,
  type OperatorClientRow,
} from "@/components/platform/OperatorClientsTable";
import {
  ModuleBrandingPanel,
  type DistributorModuleRow,
} from "@/components/platform/ModuleBrandingPanel";
import { InviteClientModal } from "@/components/platform/InviteClientModal";
import { BcnContinuityShell } from "@/components/bcn/BcnContinuityShell";
import { BcnIcon } from "@/components/bcn/BcnIcon";
import type { BcnRailGroup } from "@/components/bcn/BcnRail";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";

type Props = {
  tenantId: string;
  domainSlug: string;
  tenantName: string;
  credits: number;
};

export function OperatorDashboard({
  tenantId,
  tenantName,
  credits: initialCredits,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const theme = useBcnThemeOptional();
  const wordmark = theme.wordmark ?? defaultWordmark(theme.dataBrand);
  const [who, setWho] = useState<string | null>(null);
  const [credits, setCredits] = useState(initialCredits);
  const [clientInvites, setClientInvites] = useState<ClientInviteRow[]>([]);
  const [operatorClients, setOperatorClients] = useState<OperatorClientRow[]>([]);
  const [activeModules, setActiveModules] = useState<DistributorModuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("credit_balance, available_credits")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantRow) {
      setCredits(Number(tenantRow.credit_balance ?? tenantRow.available_credits ?? 0));
    }

    const { data: moduleData, error: moduleErr } = await supabase.rpc(
      "list_operator_modules",
      { p_tenant_id: tenantId }
    );

    if (moduleErr) {
      setError(moduleErr.message);
      setActiveModules([]);
    } else {
      setActiveModules(
        (Array.isArray(moduleData) ? moduleData : []) as DistributorModuleRow[]
      );
    }

    const { data: inviteData, error: inviteErr } = await supabase.rpc(
      "list_operator_client_invites",
      { p_tenant_id: tenantId }
    );

    if (inviteErr) setError(inviteErr.message);
    else setClientInvites((Array.isArray(inviteData) ? inviteData : []) as ClientInviteRow[]);

    const { data: clientData, error: clientErr } = await supabase.rpc(
      "list_operator_clients",
      { p_tenant_id: tenantId }
    );

    if (clientErr) setError(clientErr.message);
    else
      setOperatorClients(
        (Array.isArray(clientData) ? clientData : []) as OperatorClientRow[]
      );

    setLoading(false);
  }, [supabase, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const display =
        (typeof user.user_metadata?.full_name === "string" &&
          user.user_metadata.full_name.trim()) ||
        user.email?.split("@")[0] ||
        "Operator";
      setWho(display);
    })();
  }, [supabase]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push(PORTAL_LOGIN);
  }, [router, supabase]);

  const scrollToBranding = useCallback(() => {
    document.getElementById("module-branding")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const railGroups: BcnRailGroup[] = useMemo(
    () => [
      {
        label: "Workspace",
        items: [
          {
            id: "clients",
            icon: "people",
            label: "Your clients",
            active: true,
          },
        ],
      },
      {
        label: "Operations",
        items: [
          {
            id: "modules",
            icon: "grid",
            label: "Module branding",
            onClick: scrollToBranding,
          },
          {
            id: "invites",
            icon: "inbox",
            label: "Client invites",
            onClick: () => setInviteOpen(true),
          },
        ],
      },
    ],
    [scrollToBranding]
  );

  return (
    <>
      <BcnContinuityShell
        mode="operator"
        dataBrand={theme.dataBrand}
        wordmark={wordmark}
        homeHref="/operator"
        recordPill={{
          primary: "Your practice",
          secondary: tenantName,
        }}
        who={who}
        keyUnlocked
        railGroups={railGroups}
        onLogout={() => void handleLogout()}
        showBcnSolutionLine
      >
        <section className="view on" aria-label="Operator dashboard">
          <div className="hubhead">
            <div>
              <div className="eyebrow">{tenantName}</div>
              <h1 className="title">Your clients</h1>
            </div>
            <div className="mh-meta">
              <div className="big">{credits}</div>
              <div className="sub">seat credits</div>
            </div>
          </div>

          <div className="nextstep">
            <span className="ns-ic">
              <BcnIcon name="people" />
            </span>
            <div>
              <div className="ns-k">Quick action</div>
              <div className="ns-t">Provision a client seat</div>
            </div>
            <span className="grow" />
            <button
              type="button"
              className="btn"
              disabled={credits < 1 || activeModules.length === 0}
              onClick={() => setInviteOpen(true)}
            >
              Invite client ›
            </button>
          </div>

          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-h">
              <span className="ph-t">Your active modules</span>
            </div>
            {activeModules.length === 0 ? (
              <p className="panel-note">No modules enabled. Contact CodexOne.</p>
            ) : (
              <div className="cards3">
                {activeModules.map((m) => (
                  <div key={m.slug}>
                    <ModuleDemoFromSlug slug={m.slug} name={m.name} />
                    {m.slug === "treasury" ? (
                      <Link href="/operator/treasury" className="btn btn-secondary mt-3 inline-block">
                        Open Treasury workspace ›
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 22 }}>
            <ModuleBrandingPanel
              tenantId={tenantId}
              modules={activeModules}
              onSaved={() => void load()}
            />
          </div>

          {error ? <p className="panel-note">{error}</p> : null}

          <div className="panel" style={{ marginBottom: 22 }}>
            <div className="panel-h">
              <span className="ph-t">Provisioned clients</span>
            </div>
            {loading ? (
              <p className="panel-note">Loading…</p>
            ) : (
              <OperatorClientsTable
                tenantId={tenantId}
                clients={operatorClients}
                onChanged={load}
              />
            )}
          </div>

          <PanelInvites
            loading={loading}
            tenantId={tenantId}
            invites={clientInvites}
            onChanged={load}
          />
        </section>
      </BcnContinuityShell>

      <InviteClientModal
        open={inviteOpen}
        tenantId={tenantId}
        firmName={tenantName}
        credits={credits}
        modules={activeModules}
        onClose={() => setInviteOpen(false)}
        onProvisioned={() => void load()}
      />
    </>
  );
}

function PanelInvites({
  loading,
  tenantId,
  invites,
  onChanged,
}: {
  loading: boolean;
  tenantId: string;
  invites: ClientInviteRow[];
  onChanged: () => void;
}) {
  return (
    <div className="panel">
      <div className="panel-h">
        <span className="ph-t">Client invites</span>
      </div>
      {loading ? (
        <p className="panel-note">Loading…</p>
      ) : (
        <ClientInviteTable tenantId={tenantId} invites={invites} onChanged={onChanged} />
      )}
    </div>
  );
}
