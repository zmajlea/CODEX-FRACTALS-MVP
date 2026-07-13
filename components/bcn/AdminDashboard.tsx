"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { getSiteUrl } from "@/lib/site-url";

type VaultRow = {
  id: string;
  name: string;
  ff_status: "unstarted" | "in_progress" | "sealed";
  updated_at: string;
};

type Props = {
  tenantId: string;
  domain: string;
  initialCredits: number;
};

function statusLabel(status: VaultRow["ff_status"]) {
  if (status === "sealed") return "Sealed";
  if (status === "in_progress") return "In Progress";
  return "Unstarted";
}

function statusClass(status: VaultRow["ff_status"]) {
  return `ff-status-pill ff-status-${status}`;
}

export function AdminDashboard({ tenantId, domain, initialCredits }: Props) {
  const supabase = createClient();
  const [credits, setCredits] = useState(initialCredits);
  const [vaults, setVaults] = useState<VaultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    await supabase.rpc("claim_demo_tenant_admin");

    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("available_credits")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantRow) setCredits(tenantRow.available_credits);

    const { data, error: vaultErr } = await supabase
      .from("vaults")
      .select("id, name, ff_status, updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false });

    if (vaultErr) {
      setError(vaultErr.message);
    } else {
      setVaults((data ?? []) as VaultRow[]);
    }
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
    });

    if (rpcErr) {
      setError(rpcErr.message);
      setBusy(false);
      return;
    }

    const result = data as {
      vault_id: string;
      invite_token: string;
    } | null;

    if (result?.invite_token) {
      const origin =
        typeof window !== "undefined" ? window.location.origin : getSiteUrl();
      setInviteUrl(
        `${origin}/${domain}/wizard?invite=${result.invite_token}`
      );
      setClientName("");
      setClientEmail("");
      setInviteOpen(false);
    }

    await load();
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="ff-credits-banner mb-8">
        <p className="text-sm uppercase tracking-wide opacity-90">Seat credits</p>
        <p className="font-head text-5xl mt-1">{credits}</p>
      </div>

      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="font-head text-2xl text-obsidian">Client vaults</h1>
        <button
          type="button"
          className="ff-btn ff-btn-primary"
          disabled={credits < 1 || busy}
          onClick={() => setInviteOpen(true)}
        >
          Invite client
        </button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {inviteUrl && (
        <div className="bcn-card mb-6 border-emerald-200 bg-emerald-50/50">
          <p className="text-sm font-medium text-emerald-900 mb-2">
            Invite link created
          </p>
          <code className="text-xs break-all text-emerald-800">{inviteUrl}</code>
        </div>
      )}

      {inviteOpen && (
        <form onSubmit={handleInvite} className="bcn-card mb-8 space-y-4">
          <h2 className="font-head text-lg">Provision client seat</h2>
          <p className="text-sm text-codex-muted">
            Uses 1 credit. Creates a vault and wizard invite link.
          </p>
          <div className="ff-field">
            <label htmlFor="client-name">Client name</label>
            <input
              id="client-name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              required
            />
          </div>
          <div className="ff-field">
            <label htmlFor="client-email">Client email</label>
            <input
              id="client-email"
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex gap-3">
            <button type="submit" className="ff-btn ff-btn-primary" disabled={busy}>
              {busy ? "Provisioning…" : "Create invite"}
            </button>
            <button
              type="button"
              className="ff-btn ff-btn-ghost"
              onClick={() => setInviteOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bcn-card overflow-x-auto">
        {loading ? (
          <p className="text-sm text-codex-muted">Loading vaults…</p>
        ) : vaults.length === 0 ? (
          <p className="text-sm text-codex-muted">
            No client vaults yet. Invite a client to get started.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-codex-muted border-b border-bone">
                <th className="pb-2 pr-4 font-medium">Client</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {vaults.map((v) => (
                <tr key={v.id} className="border-b border-bone/60 last:border-0">
                  <td className="py-3 pr-4">{v.name}</td>
                  <td className="py-3 pr-4">
                    <span className={statusClass(v.ff_status)}>
                      {statusLabel(v.ff_status)}
                    </span>
                  </td>
                  <td className="py-3 text-codex-muted">
                    {new Date(v.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
