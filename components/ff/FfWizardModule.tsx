"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  decryptStringWithPassword,
  encryptStringWithPassword,
  setVaultEncryptionKeyTest,
} from "@/lib/encryption";
import { getVaultSessionKey, setVaultSessionKey } from "@/lib/vault-session";
import { FF_SECTIONS, type FfSectionPayload } from "@/lib/ff/sections";
import { WizardShell } from "@/components/ff/WizardShell";
import { RecordHub } from "@/components/ff/RecordHub";
import { TextAreaField } from "@/components/ff/atoms/Field";
import { Button } from "@/components/ff/atoms/Button";
import { Chip } from "@/components/ff/atoms/Chip";
import { useSeal } from "@/components/ff/hooks/useSeal";

type View = "hub" | "section";

export function FfWizardModule() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const supabase = createClient();

  const [vaultId, setVaultId] = useState<string | null>(null);
  const [vaultName, setVaultName] = useState("Continuity Record");
  const [view, setView] = useState<View>("hub");
  const [step, setStep] = useState(0);
  const [sections, setSections] = useState<Record<string, FfSectionPayload>>({});
  const [sectionStatus, setSectionStatus] = useState<
    Record<string, "empty" | "saved" | "sealed">
  >({});
  const [sessionReady, setSessionReady] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectionSealed, setSectionSealed] = useState(false);

  const current = FF_SECTIONS[step]!;
  const notes = useMemo(() => {
    const p = sections[current.id] ?? {};
    return typeof p.notes === "string" ? p.notes : "";
  }, [sections, current.id]);

  const commitSeal = useCallback(async () => {
    if (!vaultId) return;
    const key = getVaultSessionKey(vaultId);
    if (!key) throw new Error("Locked");

    const payload = sections[current.id] ?? { notes };
    const ciphertext = await encryptStringWithPassword(JSON.stringify(payload), key);
    const sealedAt = new Date().toISOString();

    await supabase.from("ff_continuity_sections").upsert(
      {
        vault_id: vaultId,
        section_id: current.id,
        payload_ciphertext: ciphertext,
        sealed_at: sealedAt,
      },
      { onConflict: "vault_id,section_id" }
    );

    setSectionStatus((prev) => ({ ...prev, [current.id]: "sealed" }));
    setSectionSealed(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from("platform_audit_events").insert({
      actor_id: user?.id ?? null,
      actor_tier: "client",
      action: "ff_section_sealed",
      target_type: "section",
      target_id: current.id,
      payload: { vault_id: vaultId, sealed_at: sealedAt },
    });
  }, [vaultId, sections, current.id, notes, supabase]);

  const { state: sealState, handleSeal } = useSeal(commitSeal);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login?next=/client/ff";
        return;
      }

      if (inviteToken) {
        const { data: invite } = await supabase
          .from("vault_invites")
          .select("vault_id")
          .eq("invite_token", inviteToken)
          .maybeSingle();
        if (invite?.vault_id) {
          const { data: vault } = await supabase
            .from("vaults")
            .select("id, name")
            .eq("id", invite.vault_id)
            .maybeSingle();
          if (vault) {
            setVaultId(vault.id);
            setVaultName(vault.name);
            await supabase.from("vault_members").upsert(
              { vault_id: vault.id, user_id: user.id, role: "CLIENT" },
              { onConflict: "vault_id,user_id" }
            );
          }
        }
      } else {
        const { data: grant } = await supabase
          .from("client_module_access")
          .select("vault_id, vaults(id, name)")
          .eq("client_user_id", user.id)
          .eq("status", "active")
          .not("vault_id", "is", null)
          .limit(1)
          .maybeSingle();

        const vault = grant?.vaults as { id: string; name: string } | null;
        if (grant?.vault_id && vault) {
          setVaultId(vault.id);
          setVaultName(vault.name);
        }
      }

      setLoading(false);
    }
    void init();
  }, [inviteToken, supabase]);

  useEffect(() => {
    if (!vaultId) return;
    const key = getVaultSessionKey(vaultId);
    if (!key) return;
    setSessionReady(true);
    void (async () => {
      const { data } = await supabase
        .from("ff_continuity_sections")
        .select("section_id, payload_ciphertext, sealed_at")
        .eq("vault_id", vaultId);

      const next: Record<string, FfSectionPayload> = {};
      const status: Record<string, "empty" | "saved" | "sealed"> = {};
      for (const row of data ?? []) {
        if (row.sealed_at) status[row.section_id] = "sealed";
        else status[row.section_id] = "saved";
        if (!row.payload_ciphertext) continue;
        try {
          const plain = await decryptStringWithPassword(row.payload_ciphertext, key);
          next[row.section_id] = JSON.parse(plain) as FfSectionPayload;
        } catch {
          /* skip */
        }
      }
      setSections(next);
      setSectionStatus(status);
    })();
  }, [vaultId, supabase]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!vaultId) return;
    setVaultSessionKey(vaultId, passphrase.trim());
    await setVaultEncryptionKeyTest(vaultId, passphrase.trim(), supabase);
    setSessionReady(true);
  }

  async function saveSection() {
    if (!vaultId) return;
    const key = getVaultSessionKey(vaultId);
    if (!key) return;
    const payload = sections[current.id] ?? { notes };
    const ciphertext = await encryptStringWithPassword(JSON.stringify(payload), key);
    await supabase.from("ff_continuity_sections").upsert(
      {
        vault_id: vaultId,
        section_id: current.id,
        payload_ciphertext: ciphertext,
      },
      { onConflict: "vault_id,section_id" }
    );
    setSectionStatus((prev) => ({
      ...prev,
      [current.id]: prev[current.id] === "sealed" ? "sealed" : "saved",
    }));
  }

  if (loading) return <p className="p-6 text-sm">Loading continuity record…</p>;
  if (!vaultId) {
    return (
      <p className="p-6 text-sm">
        No FF grant linked. Ask your distributor for an invite.
      </p>
    );
  }

  if (!sessionReady) {
    return (
      <form onSubmit={unlock} className="max-w-md mx-auto p-8 border border-bone rounded-xl bg-white mt-8">
        <h1 className="font-head text-xl mb-4">Secure your record</h1>
        <input
          type="password"
          className="input w-full border border-bone rounded-lg px-3 py-2 mb-4"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Encryption passphrase"
          required
          minLength={8}
        />
        <Button variant="primary">Unlock</Button>
      </form>
    );
  }

  const rail = (
    <nav className="p-3 space-y-1">
      <button type="button" className="block w-full text-left text-sm py-1" onClick={() => setView("hub")}>
        Record home
      </button>
      {FF_SECTIONS.map((s, i) => (
        <button
          key={s.id}
          type="button"
          className={`block w-full text-left text-sm py-1 px-2 rounded${
            view === "section" && step === i ? " bg-bone" : ""
          }`}
          onClick={() => {
            setStep(i);
            setView("section");
            setSectionSealed(false);
          }}
        >
          {s.short}
        </button>
      ))}
    </nav>
  );

  return (
    <WizardShell
      rail={rail}
      sealVisible={sealState === "sealed"}
      sectionSealed={sectionSealed}
    >
      {view === "hub" ? (
        <RecordHub
          vaultName={vaultName}
          sectionStatus={sectionStatus}
          activeSectionId={current.id}
          onSelect={(id) => {
            const idx = FF_SECTIONS.findIndex((s) => s.id === id);
            setStep(idx >= 0 ? idx : 0);
            setView("section");
          }}
          onNextStep={() => {
            const idx = FF_SECTIONS.findIndex((s) => sectionStatus[s.id] !== "sealed");
            setStep(idx >= 0 ? idx : 0);
            setView("section");
          }}
        />
      ) : (
        <article className="p-6">
          <Chip status={sectionStatus[current.id] ?? "empty"} label={current.short} />
          <h2 className="font-head text-2xl mt-2 mb-1">{current.title}</h2>
          <p className="sec-why italic text-sm text-codex-muted mb-4">{current.why}</p>
          <div className="sec-why border-l-4 pl-4 mb-6 text-sm" style={{ borderColor: "var(--cinnabar)" }}>
            {current.subtitle}
          </div>
          <TextAreaField
            label="Encrypted notes"
            value={notes}
            onChange={(e) =>
              setSections((prev) => ({
                ...prev,
                [current.id]: { ...(prev[current.id] ?? {}), notes: e.target.value },
              }))
            }
            onBlur={() => void saveSection()}
            disabled={sectionStatus[current.id] === "sealed"}
          />
          {error && <p className="text-red-700 text-sm">{error}</p>}
          <div className="sealbar flex items-center gap-4 mt-8 pt-4 border-t border-bone">
            <span className="saveind text-sm text-codex-muted">Saved automatically</span>
            <p className="note text-xs text-codex-muted flex-1">
              Sealing marks this section verified by you.
            </p>
            {sectionStatus[current.id] !== "sealed" && (
              <Button
                variant="seal"
                disabled={sealState === "sealing"}
                onClick={() => {
                  setError(null);
                  void handleSeal().catch((err) =>
                    setError(err instanceof Error ? err.message : "Seal failed")
                  );
                }}
              >
                {sealState === "sealing" ? "Sealing…" : "Seal this section"}
              </Button>
            )}
          </div>
          {sectionSealed && (
            <p className="sec-sealed-note text-sm text-emerald-800 mt-4">
              Section sealed. This record is verified.
            </p>
          )}
        </article>
      )}
    </WizardShell>
  );
}
