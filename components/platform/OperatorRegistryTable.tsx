"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

export type StaffInviteRow = {
  id: string;
  email: string;
  status: string;
  created_at: string;
  invite_url: string | null;
};

export type StaffManagerRow = {
  user_id: string;
  email: string;
  display_name: string | null;
  since: string;
};

export type DistributorFirmRow = {
  tenant_id: string;
  tenant_name: string;
  domain_slug: string;
  credit_balance: number;
  invites: StaffInviteRow[];
  managers: StaffManagerRow[];
};

type Props = {
  firms: DistributorFirmRow[];
};

export function OperatorRegistryTable({ firms: initialFirms }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [firms, setFirms] = useState(initialFirms);
  const [draftCredits, setDraftCredits] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function creditValue(firm: DistributorFirmRow): string {
    return draftCredits[firm.tenant_id] ?? String(firm.credit_balance);
  }

  async function saveCredits(tenantId: string) {
    const raw = draftCredits[tenantId] ?? "";
    const target = parseInt(raw, 10);
    if (Number.isNaN(target) || target < 0) {
      setErr("Credits must be a non-negative number.");
      return;
    }

    setBusyId(tenantId);
    setErr(null);
    setMsg(null);

    const { data, error } = await supabase.rpc("set_tenant_credit_balance", {
      p_tenant_id: tenantId,
      p_target_balance: target,
    });

    if (error) {
      setErr(error.message);
      setBusyId(null);
      return;
    }

    const balance = Number((data as { credit_balance?: number } | null)?.credit_balance ?? target);
    setFirms((prev) =>
      prev.map((f) =>
        f.tenant_id === tenantId ? { ...f, credit_balance: balance } : f
      )
    );
    setDraftCredits((prev) => {
      const next = { ...prev };
      delete next[tenantId];
      return next;
    });
    setMsg("Credits updated.");
    setBusyId(null);
    router.refresh();
  }

  if (firms.length === 0) {
    return (
      <p className="text-sm text-codex-muted border border-bone rounded-xl p-6 bg-white">
        No operator firms yet.
      </p>
    );
  }

  return (
    <div className="border border-bone rounded-xl p-6 bg-white overflow-x-auto">
      <h2 className="font-head text-lg mb-2">Operator registry</h2>
      <p className="text-sm text-codex-muted mb-4">
        Adjust seat credits and review Operator manager invites vs active accounts.
      </p>

      {msg && <p className="text-sm text-emerald-700 mb-3">{msg}</p>}
      {err && <p className="text-sm text-red-700 mb-3">{err}</p>}

      <table className="w-full text-sm min-w-[48rem]">
        <thead>
          <tr className="text-left text-codex-muted border-b border-bone">
            <th className="pb-2 pr-4">Firm</th>
            <th className="pb-2 pr-4">Credits</th>
            <th className="pb-2 pr-4">Invited managers</th>
            <th className="pb-2">Active managers</th>
          </tr>
        </thead>
        <tbody>
          {firms.map((firm) => (
            <tr key={firm.tenant_id} className="border-b border-bone/50 align-top">
              <td className="py-3 pr-4">
                <span className="font-medium">{firm.tenant_name}</span>
                <span className="block text-xs text-codex-muted">{firm.domain_slug}</span>
              </td>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    className="w-24 border border-bone rounded-lg px-2 py-1"
                    value={creditValue(firm)}
                    onChange={(e) =>
                      setDraftCredits((prev) => ({
                        ...prev,
                        [firm.tenant_id]: e.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-oxford text-white disabled:opacity-50"
                    disabled={busyId === firm.tenant_id}
                    onClick={() => void saveCredits(firm.tenant_id)}
                  >
                    {busyId === firm.tenant_id ? "…" : "Set"}
                  </button>
                </div>
              </td>
              <td className="py-3 pr-4">
                {firm.invites.length === 0 ? (
                  <span className="text-codex-muted">—</span>
                ) : (
                  <ul className="space-y-2">
                    {firm.invites.map((inv) => (
                      <li key={inv.id}>
                        <span className="block">{inv.email}</span>
                        <span
                          className={`text-xs uppercase tracking-wide ${
                            inv.status === "pending"
                              ? "text-amber-700"
                              : inv.status === "accepted"
                                ? "text-emerald-700"
                                : "text-codex-muted"
                          }`}
                        >
                          {inv.status}
                        </span>
                        {inv.invite_url && (
                          <span className="block text-xs text-codex-muted break-all mt-0.5">
                            {typeof window !== "undefined"
                              ? `${window.location.origin}${inv.invite_url}`
                              : inv.invite_url}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="py-3">
                {firm.managers.length === 0 ? (
                  <span className="text-codex-muted">—</span>
                ) : (
                  <ul className="space-y-2">
                    {firm.managers.map((m) => (
                      <li key={m.user_id}>
                        <span className="block">{m.display_name || m.email}</span>
                        {m.display_name && (
                          <span className="block text-xs text-codex-muted">{m.email}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
