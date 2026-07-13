"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/bcn/atoms/Field";
import { FGrid, Panel } from "@/components/bcn/forms/Panel";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";
import { tokenOverridesToStyle } from "@/lib/branding/resolve-theme";

type Props = {
  open: boolean;
  clientName: string;
  vaultId: string;
  onClose: () => void;
  onInvited?: () => void;
};

export function TrustedAdvisorInviteModal({
  open,
  clientName,
  vaultId,
  onClose,
  onInvited,
}: Props) {
  const theme = useBcnThemeOptional();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Attorney");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setRole("Attorney");
    setError(null);
    setSent(false);
    setEmailStatus(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/invites/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultId,
        name: name.trim(),
        email: email.trim(),
        role: role.trim(),
        clientName,
      }),
    });

    setBusy(false);

    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "Failed to notify advisor");
      return;
    }

    const body = (await res.json()) as { devLogged?: boolean };
    setEmailStatus(
      body.devLogged
        ? "Notification logged (dev — no RESEND_API_KEY)."
        : "Invitation email sent."
    );
    setSent(true);
    onInvited?.();
  }

  return (
    <div
      className="sealfx on"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trusted-advisor-title"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="modal-sheet"
        data-brand={theme.dataBrand}
        style={{
          width: "min(520px, 94vw)",
          maxHeight: "90vh",
          overflow: "auto",
          ...tokenOverridesToStyle(theme.tokenOverrides),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Panel>
          <div className="panel-h">
            <span className="ph-t" id="trusted-advisor-title">
              Invite a trusted advisor
            </span>
          </div>
          <p className="panel-note">
            Name a lawyer, CPA, or family member who should know this record exists.
            They receive a notification only — no financial details leave your vault.
          </p>

          {sent ? (
            <div className="panel callout">
              <p className="panel-note">
                Invitation sent to <strong>{email}</strong>.
                {emailStatus ? ` ${emailStatus}` : ""} You can add more trusted advisors
                anytime.
              </p>
              <div className="sealbar">
                <button type="button" className="btn" onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)}>
              <FGrid>
                <Field
                  label="Advisor name"
                  value={name}
                  required
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
                <Field
                  label="Email"
                  type="email"
                  value={email}
                  required
                  disabled={busy}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FGrid>
              <div className="field wide">
                <label htmlFor="advisor-role">Role</label>
                <select
                  id="advisor-role"
                  value={role}
                  disabled={busy}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="Attorney">Attorney</option>
                  <option value="Operator / Accountant">Operator / Accountant</option>
                  <option value="Financial advisor">Financial advisor</option>
                  <option value="Family member">Family member</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {error ? <p className="panel-note">{error}</p> : null}

              <div className="sealbar">
                <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
                  Cancel
                </button>
                <span className="grow" />
                <button type="submit" className="btn seal" disabled={busy}>
                  {busy ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          )}
        </Panel>
      </div>
    </div>
  );
}
