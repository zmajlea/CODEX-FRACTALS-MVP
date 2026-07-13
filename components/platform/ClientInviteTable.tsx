"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

export type ClientInviteRow = {
  invite_id: string;
  vault_id: string;
  vault_name: string;
  email: string;
  module_slug: string;
  module_name: string;
  status: string;
  created_at: string;
  invite_token: string | null;
};

type Props = {
  tenantId: string;
  invites: ClientInviteRow[];
  onChanged: () => void | Promise<void>;
};

function inviteUrl(token: string): string {
  if (typeof window === "undefined") return `/client/login?invite=${token}`;
  return `${window.location.origin}/client/login?invite=${token}`;
}

function statusClass(status: string): string {
  switch (status) {
    case "pending":
      return "text-amber-700";
    case "accepted":
      return "text-emerald-700";
    case "revoked":
      return "text-codex-muted";
    default:
      return "text-codex-muted";
  }
}

export function ClientInviteTable({ tenantId, invites: initialInvites, onChanged }: Props) {
  const supabase = createClient();
  const [invites, setInvites] = useState(initialInvites);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [flashUrl, setFlashUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setInvites(initialInvites);
  }, [initialInvites]);

  const refreshFromServer = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_operator_client_invites", {
      p_tenant_id: tenantId,
    });
    if (!error && Array.isArray(data)) {
      setInvites(data as ClientInviteRow[]);
    }
    await onChanged();
  }, [supabase, tenantId, onChanged]);

  async function copyLink(invite: ClientInviteRow) {
    if (!invite.invite_token) return;
    const url = inviteUrl(invite.invite_token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(invite.invite_id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setFlashUrl(url);
    }
  }

  async function regenerate(invite: ClientInviteRow) {
    setBusyId(invite.invite_id);
    setErr(null);
    setMsg(null);

    const { data, error } = await supabase.rpc("regenerate_client_invite", {
      p_invite_id: invite.invite_id,
    });

    if (error) {
      setErr(error.message);
      setBusyId(null);
      return;
    }

    const result = data as {
      invite_token?: string;
      charged_credits?: number;
    } | null;

    if (result?.invite_token) {
      const url = inviteUrl(result.invite_token);
      setFlashUrl(url);
      if ((result.charged_credits ?? 0) > 0) {
        setMsg(`Invite reissued (${result.charged_credits} credit charged).`);
      } else {
        setMsg("New invite link created. Previous link no longer works.");
      }
    }

    await refreshFromServer();
    setBusyId(null);
  }

  async function revoke(invite: ClientInviteRow) {
    if (!confirm(`Revoke invite for ${invite.email}? Credits will be refunded.`)) return;

    setBusyId(invite.invite_id);
    setErr(null);
    setMsg(null);

    const { data, error } = await supabase.rpc("revoke_client_invite", {
      p_invite_id: invite.invite_id,
    });

    if (error) {
      setErr(error.message);
      setBusyId(null);
      return;
    }

    const refunded = (data as { refunded_credits?: number } | null)?.refunded_credits ?? 0;
    setMsg(`Invite revoked. ${refunded} credit${refunded === 1 ? "" : "s"} refunded.`);
    setFlashUrl(null);
    await refreshFromServer();
    setBusyId(null);
  }

  if (invites.length === 0) {
    return (
      <p className="text-sm text-codex-muted">No client invites yet.</p>
    );
  }

  return (
    <div>
      {msg && <p className="text-sm text-emerald-700 mb-3">{msg}</p>}
      {err && <p className="text-sm text-red-700 mb-3">{err}</p>}
      {flashUrl && (
        <p className="text-sm break-all text-emerald-800 bg-emerald-50 p-3 rounded-lg mb-4">
          Invite link: {flashUrl}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[40rem]">
          <thead>
            <tr className="text-left text-codex-muted border-b border-bone">
              <th className="pb-2 pr-4">Client</th>
              <th className="pb-2 pr-4">Module</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => {
              const busy = busyId === inv.invite_id;
              const canLink = inv.status === "pending" && inv.invite_token;
              const canRecreate = inv.status === "pending" || inv.status === "revoked";
              const canRevoke = inv.status === "pending";

              return (
                <tr key={inv.invite_id} className="border-b border-bone/50 align-top">
                  <td className="py-3 pr-4">
                    <span className="font-medium block">{inv.vault_name}</span>
                    <span className="text-xs text-codex-muted">{inv.email}</span>
                  </td>
                  <td className="py-3 pr-4">{inv.module_name}</td>
                  <td className="py-3 pr-4">
                    <span className={`text-xs uppercase tracking-wide ${statusClass(inv.status)}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      {canLink && (
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded border border-bone hover:bg-bone/30 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => void copyLink(inv)}
                        >
                          {copiedId === inv.invite_id ? "Copied" : "Copy link"}
                        </button>
                      )}
                      {canRecreate && (
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded border border-bone hover:bg-bone/30 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => void regenerate(inv)}
                        >
                          {inv.status === "revoked" ? "Reissue" : "New link"}
                        </button>
                      )}
                      {canRevoke && (
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded border border-red-200 text-red-800 hover:bg-red-50 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => void revoke(inv)}
                        >
                          Revoke
                        </button>
                      )}
                      {inv.status === "accepted" && (
                        <span className="text-xs text-codex-muted">Joined</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
