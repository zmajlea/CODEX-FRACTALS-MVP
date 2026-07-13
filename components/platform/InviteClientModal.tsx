"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { ModuleDemoFromSlug } from "@/components/platform/ModuleDemoCard";
import { demoForModule } from "@/lib/platform/module-demos";
import { Field } from "@/components/bcn/atoms/Field";
import { FGrid, Panel } from "@/components/bcn/forms/Panel";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";
import { tokenOverridesToStyle } from "@/lib/branding/resolve-theme";

type ActiveModule = {
  slug: string;
  name: string;
  status: string;
};

type Props = {
  open: boolean;
  tenantId: string;
  firmName: string;
  credits: number;
  modules: ActiveModule[];
  onClose: () => void;
  onProvisioned: () => void;
};

export function InviteClientModal({
  open,
  tenantId,
  firmName,
  credits,
  modules,
  onClose,
  onProvisioned,
}: Props) {
  const supabase = createClient();
  const theme = useBcnThemeOptional();
  const [moduleSlug, setModuleSlug] = useState(modules[0]?.slug ?? "bcn");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [lastModuleSlug, setLastModuleSlug] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setInviteUrl(null);
    setLastModuleSlug(null);
    setEmailStatus(null);
    setClientName("");
    setClientEmail("");
    if (modules.length > 0 && !modules.some((m) => m.slug === moduleSlug)) {
      setModuleSlug(modules[0]!.slug);
    }
  }, [open, modules, moduleSlug]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const selectedDemo = demoForModule(
    moduleSlug,
    modules.find((m) => m.slug === moduleSlug)?.name
  );
  const canSubmit = credits >= 1 && modules.length > 0 && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    setInviteUrl(null);
    setLastModuleSlug(null);
    setEmailStatus(null);

    const trimmedName = clientName.trim();
    const trimmedEmail = clientEmail.trim();

    const { data, error: rpcErr } = await supabase.rpc("provision_client_seat", {
      p_tenant_id: tenantId,
      p_client_name: trimmedName,
      p_client_email: trimmedEmail,
      p_module_slug: moduleSlug,
    });

    setBusy(false);

    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }

    const result = data as { invite_token?: string; module_slug?: string } | null;
    if (result?.invite_token) {
      const origin = window.location.origin;
      const url = `${origin}/client/login?invite=${result.invite_token}`;
      const moduleName =
        modules.find((m) => m.slug === (result.module_slug ?? moduleSlug))?.name ??
        "Continuity";

      setInviteUrl(url);
      setLastModuleSlug(result.module_slug ?? moduleSlug);
      setClientName("");
      setClientEmail("");
      onProvisioned();

      const emailRes = await fetch("/api/operator/send-client-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          clientEmail: trimmedEmail,
          clientName: trimmedName,
          firmName,
          moduleName,
          inviteUrl: url,
        }),
      });

      if (emailRes.ok) {
        const body = (await emailRes.json()) as { devLogged?: boolean };
        setEmailStatus(
          body.devLogged
            ? "Invite email logged (dev — no RESEND_API_KEY)."
            : "Invite email sent to your client."
        );
      } else {
        setEmailStatus("Seat provisioned. Copy the link below — email could not be sent.");
      }
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="sealfx on"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-client-title"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="modal-sheet"
        data-brand={theme.dataBrand}
        style={{
          width: "min(540px, 94vw)",
          maxHeight: "90vh",
          overflow: "auto",
          ...tokenOverridesToStyle(theme.tokenOverrides),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Panel>
          <div className="panel-h">
            <span className="ph-t" id="invite-client-title">
              Invite client
            </span>
          </div>
          <p className="panel-note">
            Provisions a seat, deducts <strong>1 credit</strong> from your firm balance, and
            records a ledger entry. Share the invite link with your client.
          </p>

          <form onSubmit={(e) => void handleSubmit(e)}>
            {modules.length > 0 ? (
              <div className="field wide">
                <label htmlFor="invite-module">Module</label>
                <select
                  id="invite-module"
                  value={moduleSlug}
                  disabled={busy}
                  onChange={(e) => setModuleSlug(e.target.value)}
                >
                  {modules.map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.name}
                      {m.status === "beta" ? " (beta)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div style={{ marginBottom: 14 }}>
              <ModuleDemoFromSlug
                slug={selectedDemo.slug}
                name={selectedDemo.name}
                compact
              />
            </div>

            <FGrid>
              <Field
                label="Client name"
                value={clientName}
                required
                disabled={busy}
                onChange={(e) => setClientName(e.target.value)}
              />
              <Field
                label="Client email"
                type="email"
                value={clientEmail}
                required
                disabled={busy}
                onChange={(e) => setClientEmail(e.target.value)}
              />
            </FGrid>

            {credits < 1 ? (
              <p className="panel-note">Insufficient seat credits. Contact CodexOne to top up.</p>
            ) : null}
            {error ? <p className="panel-note">{error}</p> : null}

            {inviteUrl ? (
              <div className="panel callout">
                {emailStatus ? <p className="panel-note">{emailStatus}</p> : null}
                <p className="panel-note" style={{ wordBreak: "break-all" }}>
                  Client invite: {inviteUrl}
                </p>
                <button type="button" className="btn ghost" onClick={() => void copyInvite()}>
                  Copy link
                </button>
                {lastModuleSlug ? (
                  <div style={{ marginTop: 12 }}>
                    <ModuleDemoFromSlug slug={lastModuleSlug} />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="sealbar">
              <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
                {inviteUrl ? "Close" : "Cancel"}
              </button>
              <span className="grow" />
              {!inviteUrl ? (
                <button type="submit" className="btn" disabled={!canSubmit}>
                  {busy ? "Provisioning…" : "Provision seat & invite"}
                </button>
              ) : null}
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}
