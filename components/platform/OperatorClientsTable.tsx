"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";

export type OperatorClientRow = {
  grant_id: string;
  client_user_id: string;
  client_email: string;
  client_name: string;
  module_slug: string;
  module_name: string;
  vault_id: string | null;
  vault_name: string | null;
  grant_status: string;
  ff_status: string | null;
  granted_at: string;
  sealed_sections: number;
};

type Props = {
  tenantId: string;
  clients: OperatorClientRow[];
  onChanged: () => void | Promise<void>;
};

export function OperatorClientsTable({
  tenantId,
  clients: initialClients,
  onChanged,
}: Props) {
  const supabase = createClient();
  const [clients, setClients] = useState(initialClients);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setClients(initialClients);
  }, [initialClients]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc("list_operator_clients", {
      p_tenant_id: tenantId,
    });
    if (Array.isArray(data)) {
      setClients(data as OperatorClientRow[]);
    }
    await onChanged();
  }, [supabase, tenantId, onChanged]);

  async function revokeAccess(row: OperatorClientRow) {
    if (
      !confirm(
        `Revoke access for ${row.client_name}? They will no longer reach this module from your firm.`
      )
    ) {
      return;
    }
    setBusyId(row.grant_id);
    setErr(null);
    setMsg(null);
    const { error } = await supabase.rpc("revoke_operator_client_access", {
      p_grant_id: row.grant_id,
    });
    if (error) setErr(error.message);
    else setMsg(`Access revoked for ${row.client_email}.`);
    await refresh();
    setBusyId(null);
    setOpenMenuId(null);
  }

  async function eraseRecord(row: OperatorClientRow) {
    if (
      !confirm(
        `Erase ${row.vault_name ?? "this record"} for ${row.client_name}? This permanently deletes the vault and encrypted sections. The client's login account is kept.`
      )
    ) {
      return;
    }
    setBusyId(row.grant_id);
    setErr(null);
    setMsg(null);
    const { error } = await supabase.rpc("erase_operator_client_record", {
      p_grant_id: row.grant_id,
    });
    if (error) setErr(error.message);
    else setMsg(`Record erased for ${row.client_email}.`);
    await refresh();
    setBusyId(null);
    setOpenMenuId(null);
  }

  if (clients.length === 0) {
    return (
      <p className="panel-note">No provisioned clients yet. Invite a client to get started.</p>
    );
  }

  return (
    <div>
      {msg ? <p className="panel-note" style={{ color: "var(--brand)" }}>{msg}</p> : null}
      {err ? <p className="panel-note">{err}</p> : null}
      <div className="overflow-x-auto">
        <table className="dtable">
          <thead>
            <tr>
              <th>Client</th>
              <th>Module</th>
              <th>Record</th>
              <th>Status</th>
              <th>Sealed</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {clients.map((row) => {
              const isBusy = busyId === row.grant_id;
              const menuOpen = openMenuId === row.grant_id;
              return (
                <tr key={row.grant_id}>
                  <td>
                    <div>{row.client_name}</div>
                    <div className="panel-note" style={{ margin: 0 }}>
                      {row.client_email}
                    </div>
                  </td>
                  <td>{row.module_name}</td>
                  <td>{row.vault_name ?? "—"}</td>
                  <td>{row.grant_status}</td>
                  <td>{row.sealed_sections}/12</td>
                  <td style={{ position: "relative", textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn sm ghost"
                      disabled={isBusy || row.grant_status === "revoked"}
                      aria-expanded={menuOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(menuOpen ? null : row.grant_id);
                      }}
                    >
                      Actions ▾
                    </button>
                    {menuOpen ? (
                      <div
                        ref={menuRef}
                        className="panel"
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "100%",
                          zIndex: 20,
                          minWidth: 180,
                          marginTop: 4,
                          padding: "8px 0",
                        }}
                      >
                        <button
                          type="button"
                          className="btn ghost sm"
                          style={{ width: "100%", justifyContent: "flex-start" }}
                          disabled={isBusy}
                          onClick={() => void revokeAccess(row)}
                        >
                          Revoke access
                        </button>
                        <button
                          type="button"
                          className="btn ghost sm"
                          style={{ width: "100%", justifyContent: "flex-start" }}
                          disabled={isBusy || !row.vault_id}
                          onClick={() => void eraseRecord(row)}
                        >
                          Erase record
                        </button>
                      </div>
                    ) : null}
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
