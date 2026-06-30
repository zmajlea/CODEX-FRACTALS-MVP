"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

type VaultRow = {
  id: string;
  name: string;
  ff_status: "unstarted" | "in_progress" | "sealed";
  updated_at: string;
};

type Props = {
  tenantId: string;
  domainSlug: string;
  tenantName: string;
  credits: number;
};

export function DistributorDashboard({
  tenantId,
  domainSlug,
  tenantName,
  credits: initialCredits,
}: Props) {
  const supabase = createClient();
  const [credits, setCredits] = useState(initialCredits);
  const [vaults, setVaults] = useState<VaultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    await supabase.rpc("claim_demo_tenant_admin");

    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("credit_balance, available_credits")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantRow) {
      setCredits(Number(tenantRow.credit_balance ?? tenantRow.available_credits ?? 0));
    }

    const { data, error: vaultErr } = await supabase
      .from("vaults")
      .select("id, name, ff_status, updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false });

    if (vaultErr) setError(vaultErr.message);
    else setVaults((data ?? []) as VaultRow[]);
    setLoading(false);
  }, [supabase, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInviteUrl(null);

    const { data, error: rpcErr } = await supabase.rpc("provision_client_seat", {
      p_tenant_id: tenantId,
      p_client_name: clientName.trim(),
      p_client_email: clientEmail.trim(),
      p_module_slug: "ff",
    });

    if (rpcErr) {
      setError(rpcErr.message);
      setBusy(false);
      return;
    }

    const result = data as { invite_token?: string } | null;
    if (result?.invite_token) {
      const origin = window.location.origin;
      setInviteUrl(
        `${origin}/client/ff?invite=${result.invite_token}&domain=${domainSlug}`
      );
      setClientName("");
      setClientEmail("");
    }

    await load();
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-xs uppercase tracking-wide text-codex-muted mb-1">{tenantName}</p>
      <h1 className="font-head text-2xl mb-6">Distributor dashboard</h1>

      <div className="ff-credits-banner mb-8 rounded-xl p-6 text-white" style={{ background: "var(--cinnabar)" }}>
        <p className="text-sm opacity-90">Seat credits</p>
        <p className="font-head text-5xl">{credits}</p>
      </div>

      <form onSubmit={handleInvite} className="border border-bone rounded-xl p-6 mb-8 bg-white">
        <h2 className="font-head text-lg mb-4">Invite client (FF module)</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <input
            className="border border-bone rounded-lg px-3 py-2"
            placeholder="Client name"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            required
          />
          <input
            className="border border-bone rounded-lg px-3 py-2"
            type="email"
            placeholder="Client email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            required
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary px-4 py-2 rounded-lg bg-oxford text-white"
          disabled={busy || credits < 1}
        >
          {busy ? "Provisioning…" : "Provision seat"}
        </button>
      </form>

      {inviteUrl && (
        <p className="text-sm mb-6 break-all text-emerald-800 bg-emerald-50 p-3 rounded-lg">
          Invite: {inviteUrl}
        </p>
      )}
      {error && <p className="text-red-700 text-sm mb-4">{error}</p>}

      <div className="border border-bone rounded-xl p-6 bg-white">
        <h2 className="font-head text-lg mb-4">Client vaults</h2>
        {loading ? (
          <p className="text-sm text-codex-muted">Loading…</p>
        ) : vaults.length === 0 ? (
          <p className="text-sm text-codex-muted">No clients yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {vaults.map((v) => (
              <li key={v.id} className="flex justify-between border-b border-bone/60 py-2">
                <span>{v.name}</span>
                <span className="text-codex-muted">{v.ff_status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
