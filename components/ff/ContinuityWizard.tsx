"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  encryptStringWithPassword,
  decryptStringWithPassword,
  setVaultEncryptionKeyTest,
} from "@/lib/encryption";
import {
  getVaultSessionKey,
  setVaultSessionKey,
} from "@/lib/vault-session";
import { FF_SECTIONS, type FfSectionPayload } from "@/lib/ff/sections";
import { SealFx } from "@/components/ff/SealFx";

type SealPhase = "idle" | "sealing" | "sealed";

type Props = {
  domain: string;
};

export function ContinuityWizard({ domain }: Props) {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const supabase = createClient();

  const [vaultId, setVaultId] = useState<string | null>(null);
  const [vaultName, setVaultName] = useState("");
  const [ffStatus, setFfStatus] = useState<"unstarted" | "in_progress" | "sealed">(
    "unstarted"
  );
  const [step, setStep] = useState(0);
  const [sections, setSections] = useState<Record<string, FfSectionPayload>>({});
  const [sessionReady, setSessionReady] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [sealPhase, setSealPhase] = useState<SealPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [advisorName, setAdvisorName] = useState("");
  const [advisorEmail, setAdvisorEmail] = useState("");
  const [advisorRole, setAdvisorRole] = useState("CPA / Tax Advisor");
  const [protocolOpen, setProtocolOpen] = useState(false);

  const current = FF_SECTIONS[step]!;

  const sectionNotes = useMemo(() => {
    const payload = sections[current.id] ?? {};
    return typeof payload.notes === "string" ? payload.notes : "";
  }, [sections, current.id]);

  const acceptInvite = useCallback(
    async (token: string) => {
      const { data: invite, error: invErr } = await supabase
        .from("vault_invites")
        .select("id, vault_id, email, status")
        .eq("invite_token", token)
        .maybeSingle();

      if (invErr || !invite) {
        throw new Error(invErr?.message ?? "Invite not found");
      }

      const { data: vault } = await supabase
        .from("vaults")
        .select("id, name, ff_status, tenant_id")
        .eq("id", invite.vault_id)
        .maybeSingle();

      if (!vault) throw new Error("Vault not found");

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required");

      await supabase.from("vault_members").upsert(
        {
          vault_id: vault.id,
          user_id: user.id,
          role: "CLIENT",
        },
        { onConflict: "vault_id,user_id" }
      );

      if (vault.tenant_id) {
        await supabase.from("user_roles").upsert(
          {
            user_id: user.id,
            role: "client",
            tenant_id: vault.tenant_id,
          },
          { onConflict: "user_id,tenant_id" }
        );
      }

      if (invite.status === "pending") {
        await supabase
          .from("vault_invites")
          .update({ status: "accepted" })
          .eq("id", invite.id);
      }

      setVaultId(vault.id);
      setVaultName(vault.name);
      setFfStatus(vault.ff_status);
    },
    [supabase]
  );

  const loadSections = useCallback(
    async (vId: string, key: string) => {
      const { data } = await supabase
        .from("ff_continuity_sections")
        .select("section_id, payload_ciphertext")
        .eq("vault_id", vId);

      const next: Record<string, FfSectionPayload> = {};
      for (const row of data ?? []) {
        if (!row.payload_ciphertext) continue;
        try {
          const plain = await decryptStringWithPassword(
            row.payload_ciphertext,
            key
          );
          next[row.section_id] = JSON.parse(plain) as FfSectionPayload;
        } catch {
          /* skip corrupt */
        }
      }
      setSections((prev) => ({ ...prev, ...next }));
    },
    [supabase]
  );

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          const next = inviteToken
            ? `/${domain}/wizard?invite=${inviteToken}`
            : `/${domain}/wizard`;
          window.location.href = `/login?next=${encodeURIComponent(next)}`;
          return;
        }

        if (inviteToken) {
          await acceptInvite(inviteToken);
        } else {
          const { data: membership } = await supabase
            .from("vault_members")
            .select("vault_id, vaults(id, name, ff_status, tenant_id, tenants(domain_slug))")
            .eq("user_id", user.id)
            .limit(20);

          const match = (membership ?? []).find((m) => {
            const vault = m.vaults as {
              tenants?: { domain_slug: string } | null;
            } | null;
            return vault?.tenants?.domain_slug === domain;
          });

          if (match?.vault_id) {
            const vault = match.vaults as {
              id: string;
              name: string;
              ff_status: typeof ffStatus;
            };
            setVaultId(vault.id);
            setVaultName(vault.name);
            setFfStatus(vault.ff_status);
          }
        }

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load wizard");
        setLoading(false);
      }
    }
    void init();
  }, [acceptInvite, domain, inviteToken, supabase]);

  useEffect(() => {
    if (!vaultId) return;
    const key = getVaultSessionKey(vaultId);
    if (key) {
      setSessionReady(true);
      void loadSections(vaultId, key);
    }
  }, [vaultId, loadSections]);

  async function unlockVault(e: React.FormEvent) {
    e.preventDefault();
    if (!vaultId || !passphrase.trim()) return;
    setVaultSessionKey(vaultId, passphrase.trim());
    await setVaultEncryptionKeyTest(vaultId, passphrase.trim(), supabase);
    setSessionReady(true);
    await loadSections(vaultId, passphrase.trim());
    if (ffStatus === "unstarted") {
      await supabase
        .from("vaults")
        .update({ ff_status: "in_progress" })
        .eq("id", vaultId);
      setFfStatus("in_progress");
    }
  }

  async function saveSection(sectionId: string, payload: FfSectionPayload) {
    if (!vaultId) return;
    const key = getVaultSessionKey(vaultId);
    if (!key) return;

    const ciphertext = await encryptStringWithPassword(
      JSON.stringify(payload),
      key
    );

    await supabase.from("ff_continuity_sections").upsert(
      {
        vault_id: vaultId,
        section_id: sectionId,
        payload_ciphertext: ciphertext,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "vault_id,section_id" }
    );

    if (ffStatus === "unstarted") {
      await supabase
        .from("vaults")
        .update({ ff_status: "in_progress" })
        .eq("id", vaultId);
      setFfStatus("in_progress");
    }
  }

  function updateNotes(value: string) {
    const payload: FfSectionPayload = { ...(sections[current.id] ?? {}), notes: value };
    setSections((prev) => ({ ...prev, [current.id]: payload }));
  }

  async function handleSectionBlur() {
    const payload = sections[current.id] ?? { notes: "" };
    await saveSection(current.id, payload);
  }

  async function handleSeal() {
    if (!vaultId) return;
    const key = getVaultSessionKey(vaultId);
    if (!key) {
      setError("Set your encryption passphrase before sealing.");
      return;
    }

    setSealPhase("sealing");
    setError(null);

    try {
      const sealedAt = new Date().toISOString();

      for (const section of FF_SECTIONS) {
        const payload = sections[section.id] ?? { notes: "" };
        const ciphertext = await encryptStringWithPassword(
          JSON.stringify(payload),
          key
        );
        await supabase.from("ff_continuity_sections").upsert(
          {
            vault_id: vaultId,
            section_id: section.id,
            payload_ciphertext: ciphertext,
            sealed_at: sealedAt,
            updated_at: sealedAt,
          },
          { onConflict: "vault_id,section_id" }
        );
      }

      await supabase
        .from("vaults")
        .update({ ff_status: "sealed" })
        .eq("id", vaultId);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      await supabase.from("record_activity_events").insert({
        vault_id: vaultId,
        event_type: "ff_continuity_sealed",
        actor_id: user?.id ?? null,
        payload: { sealed_at: sealedAt },
      });

      setFfStatus("sealed");
      setSealPhase("sealed");
    } catch (err) {
      setSealPhase("idle");
      setError(err instanceof Error ? err.message : "Seal failed");
    }
  }

  async function handleAddAdvisor(e: React.FormEvent) {
    e.preventDefault();
    if (!vaultId) return;

    const res = await fetch("/api/invites/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultId,
        name: advisorName.trim(),
        email: advisorEmail.trim(),
        role: advisorRole.trim(),
        clientName: vaultName,
      }),
    });

    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "Failed to notify advisor");
      return;
    }

    setAdvisorName("");
    setAdvisorEmail("");
  }

  async function handleProtocolActivate() {
    if (!vaultId) return;
    setProtocolOpen(false);

    const res = await fetch("/api/protocol/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaultId, clientName: vaultName, domain }),
    });

    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "Protocol activation failed");
    }
  }

  if (loading) {
    return (
      <p className="px-6 py-12 text-sm text-codex-muted">Loading continuity wizard…</p>
    );
  }

  if (!vaultId) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="font-head text-2xl mb-3">No vault linked</h1>
        <p className="text-sm text-codex-muted">
          Open the invite link from your CPA, or ask your firm admin to provision a seat.
        </p>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <form
        onSubmit={unlockVault}
        className="mx-auto max-w-md px-6 py-16 ff-card mt-8"
      >
        <h1 className="font-head text-xl mb-2">Secure your record</h1>
        <p className="text-sm text-codex-muted mb-6">
          Choose a passphrase for <strong>{vaultName}</strong>. Financial details are
          encrypted in your browser before saving.
        </p>
        <div className="ff-field">
          <label htmlFor="passphrase">Encryption passphrase</label>
          <input
            id="passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <button type="submit" className="ff-btn ff-btn-primary w-full">
          Unlock wizard
        </button>
      </form>
    );
  }

  return (
    <>
      <SealFx visible={sealPhase === "sealed"} />
      <div className="ff-wizard-layout">
        <aside className="ff-rail">
          <p className="text-xs uppercase tracking-wide text-codex-muted mb-2">
            Sections
          </p>
          {FF_SECTIONS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`ff-rail-item${i === step ? " active" : ""}${
                sections[s.id]?.notes ? " done" : ""
              }`}
              onClick={() => setStep(i)}
            >
              {s.short}
            </button>
          ))}
        </aside>

        <section className="ff-card">
          <p className="text-xs text-codex-muted mb-1">
            {vaultName} · {ffStatus.replace("_", " ")}
          </p>
          <h2 className="font-head text-xl mb-1">{current.title}</h2>
          <p className="text-sm italic text-codex-muted mb-1">{current.why}</p>
          <p className="text-sm text-codex-muted mb-6">{current.subtitle}</p>

          <div className="ff-field">
            <label htmlFor="section-notes">Notes & details (encrypted)</label>
            <textarea
              id="section-notes"
              value={sectionNotes}
              onChange={(e) => updateNotes(e.target.value)}
              onBlur={() => void handleSectionBlur()}
              disabled={ffStatus === "sealed"}
              placeholder="Enter contacts, accounts, locations, and guidance for this section…"
            />
          </div>

          {current.id === "advisors" && ffStatus !== "sealed" && (
            <form onSubmit={handleAddAdvisor} className="border-t border-bone pt-6 mt-6">
              <h3 className="font-head text-base mb-3">Add trusted advisor</h3>
              <p className="text-xs text-codex-muted mb-4">
                Name, email, and role are stored for notification delivery. Vault content
                stays encrypted.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="ff-field">
                  <label htmlFor="adv-name">Name</label>
                  <input
                    id="adv-name"
                    value={advisorName}
                    onChange={(e) => setAdvisorName(e.target.value)}
                    required
                  />
                </div>
                <div className="ff-field">
                  <label htmlFor="adv-email">Email</label>
                  <input
                    id="adv-email"
                    type="email"
                    value={advisorEmail}
                    onChange={(e) => setAdvisorEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="ff-field">
                <label htmlFor="adv-role">Role</label>
                <input
                  id="adv-role"
                  value={advisorRole}
                  onChange={(e) => setAdvisorRole(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="ff-btn ff-btn-ghost">
                Notify advisor
              </button>
            </form>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-700">{error}</p>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-8 pt-6 border-t border-bone">
            <button
              type="button"
              className="ff-btn ff-btn-ghost"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="ff-btn ff-btn-ghost"
              disabled={step >= FF_SECTIONS.length - 1}
              onClick={() => setStep((s) => Math.min(FF_SECTIONS.length - 1, s + 1))}
            >
              Next
            </button>
            {ffStatus !== "sealed" && (
              <button
                type="button"
                className="ff-btn ff-btn-primary ml-auto"
                disabled={sealPhase === "sealing"}
                onClick={() => void handleSeal()}
              >
                {sealPhase === "sealing" ? "Sealing…" : "Seal continuity record"}
              </button>
            )}
            {ffStatus === "sealed" && (
              <button
                type="button"
                className="ff-btn ff-btn-danger ml-auto"
                onClick={() => setProtocolOpen(true)}
              >
                Activate emergency protocol
              </button>
            )}
          </div>
        </section>
      </div>

      {protocolOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="ff-card max-w-md w-full">
            <h3 className="font-head text-lg text-red-800 mb-2">
              Activate emergency protocol?
            </h3>
            <p className="text-sm text-codex-muted mb-6">
              This notifies trusted advisors by email with a non-sensitive summary. Encrypted
              financial data is never sent from the server.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                className="ff-btn ff-btn-ghost"
                onClick={() => setProtocolOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ff-btn ff-btn-danger"
                onClick={() => void handleProtocolActivate()}
              >
                Confirm activation
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
