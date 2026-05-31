"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Switchboard, { type VaultEntity } from "@/components/Switchboard";
import EncryptionKeyModal from "@/components/EncryptionKeyModal";
import SecurityDashboard from "@/components/SecurityDashboard";
import VaultFileUpload from "@/components/VaultFileUpload";
import { setVaultEncryptionKeyTest } from "@/lib/encryption";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import {
  clearVaultSessionKey,
  getVaultSessionKey,
  setVaultSessionKey,
} from "@/lib/vault-session";
import type { VaultSummary } from "@/lib/types";
import { createClient } from "@/utils/supabase/client";

function generateSecureKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 32);
}

type SavedKeyPrompt = {
  vaultId: string;
  vaultName: string;
  key: string;
};

export default function SwitchboardPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingVault, setPendingVault] = useState<VaultSummary | null>(null);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");
  const [newVaultKey, setNewVaultKey] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [savedKeyPrompt, setSavedKeyPrompt] = useState<SavedKeyPrompt | null>(
    null
  );
  const [keyCopied, setKeyCopied] = useState(false);

  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [inboxRecordId, setInboxRecordId] = useState<string | null>(null);

  const refreshUnlocked = useCallback((vaultList: VaultSummary[]) => {
    const ids = new Set<string>();
    for (const v of vaultList) {
      if (getVaultSessionKey(v.id)) ids.add(v.id);
    }
    setUnlockedIds(ids);
  }, []);

  const loadVaults = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    try {
      await ensureUserProfile(supabase);
    } catch (profileErr) {
      setError(
        profileErr instanceof Error ? profileErr.message : "Profile setup failed"
      );
      setLoading(false);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from("vault_members")
      .select(
        "role, vault_id, vaults ( id, name, created_by, encryption_test )"
      )
      .eq("user_id", user.id);

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const mapped: VaultSummary[] = (data ?? [])
      .map((row) => {
        const vault = row.vaults as {
          id: string;
          name: string;
          created_by: string | null;
          encryption_test: string | null;
        } | null;
        if (!vault) return null;
        return {
          id: vault.id,
          name: vault.name,
          created_by: vault.created_by,
          encryption_test: vault.encryption_test,
          role: row.role as string,
        };
      })
      .filter((v): v is VaultSummary => v !== null);

    setVaults(mapped);
    refreshUnlocked(mapped);
    setLoading(false);
  }, [supabase, router, refreshUnlocked]);

  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  const ensureInboxRecord = useCallback(
    async (vaultId: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: existing } = await supabase
        .from("records")
        .select("id")
        .eq("vault_id", vaultId)
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        setInboxRecordId(existing.id);
        return existing.id;
      }

      const { data, error: insertError } = await supabase
        .from("records")
        .insert({
          vault_id: vaultId,
          title_plain: "Inbox",
          status: "draft",
          created_by: user.id,
        })
        .select("id")
        .single();

      if (insertError || !data) {
        setError(insertError?.message ?? "Could not create inbox record");
        return null;
      }

      setInboxRecordId(data.id);
      return data.id;
    },
    [supabase]
  );

  useEffect(() => {
    if (activeVaultId && unlockedIds.has(activeVaultId)) {
      ensureInboxRecord(activeVaultId);
    }
  }, [activeVaultId, unlockedIds, ensureInboxRecord]);

  const vaultEntities: VaultEntity[] = vaults.map((v) => ({
    id: v.id,
    name: v.name,
    unlocked: unlockedIds.has(v.id),
  }));

  const handleSelectVault = (vault: VaultEntity) => {
    const full = vaults.find((v) => v.id === vault.id);
    if (!full) return;

    if (vault.unlocked) {
      setActiveVaultId(vault.id);
      return;
    }

    setPendingVault(full);
  };

  const handleKeySave = (key: string | null) => {
    if (!pendingVault) return;

    if (key) {
      setVaultSessionKey(pendingVault.id, key);
      setUnlockedIds((prev) => new Set(prev).add(pendingVault.id));
      setActiveVaultId(pendingVault.id);
    } else {
      clearVaultSessionKey(pendingVault.id);
      setUnlockedIds((prev) => {
        const next = new Set(prev);
        next.delete(pendingVault.id);
        return next;
      });
      if (activeVaultId === pendingVault.id) {
        setActiveVaultId(null);
        setInboxRecordId(null);
      }
    }
  };

  const createVaultWithKey = async (name: string, key: string) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      throw new Error("Session expired. Please sign in again.");
    }

    await ensureUserProfile(supabase);

    const { data: vault, error: insertError } = await supabase.rpc(
      "create_vault",
      { p_name: name.trim() }
    );

    if (insertError || !vault) {
      const hint =
        insertError?.message?.includes("create_vault") ||
        insertError?.code === "PGRST202"
          ? " Run supabase/migrations/20260530140000_fix_vault_create_rls.sql in the SQL Editor."
          : "";
      throw new Error(
        (insertError?.message ?? "Failed to create vault") + hint
      );
    }

    await setVaultEncryptionKeyTest(vault.id, key, supabase);
    setVaultSessionKey(vault.id, key);

    await loadVaults();
    setActiveVaultId(vault.id);
    setUnlockedIds((prev) => new Set(prev).add(vault.id));

    return { id: vault.id, name: vault.name };
  };

  const handleGenerateVault = async () => {
    setCreateError(null);
    setGenerating(true);

    try {
      const key = generateSecureKey();
      const vault = await createVaultWithKey("Sovereign Archive", key);
      setSavedKeyPrompt({
        vaultId: vault.id,
        vaultName: vault.name,
        key,
      });
      setKeyCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vault generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateVault = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      await createVaultWithKey(newVaultName, newVaultKey);
      setShowCreateModal(false);
      setNewVaultName("");
      setNewVaultKey("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const handleCopyGeneratedKey = async () => {
    if (!savedKeyPrompt) return;
    try {
      await navigator.clipboard.writeText(savedKeyPrompt.key);
      setKeyCopied(true);
    } catch {
      setKeyCopied(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const activeVault = vaults.find((v) => v.id === activeVaultId);
  const unlockedCount = vaultEntities.filter((v) => v.unlocked).length;

  return (
    <div className="min-h-screen bg-vellum">
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-8 py-4 border-b border-bone/40 bg-vellum/90 backdrop-blur-sm">
        <div className="flex items-center gap-6">
          <div className="font-head text-lg tracking-wide text-obsidian">
            Fractals · Airlock
          </div>
          {vaults.length > 0 && (
            <a
              href="/portfolio"
              className="font-data text-[10px] uppercase tracking-ultra text-emerald-500/80 hover:text-emerald-500 border border-emerald-500/30 px-3 py-1 hover:bg-emerald-500/5"
            >
              Portfolio Query →
            </a>
          )}
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setIsSecurityOpen(true)}
            className="font-data text-[10px] uppercase tracking-ultra text-oxford hover:text-obsidian border border-bone/50 px-3 py-1.5 hover:bg-bone/10 flex items-center gap-2"
            title="Randall Trust Protocol"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Integrity
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50 hover:text-obsidian"
          >
            Sign out
          </button>
        </div>
      </header>

      <SecurityDashboard
        isOpen={isSecurityOpen}
        onClose={() => setIsSecurityOpen(false)}
        recordName={activeVault?.name ?? "Switchboard"}
        unlockedVaultCount={unlockedCount}
        totalVaultCount={vaults.length}
      />

      <div className="pt-20">
        {loading && (
          <p className="text-center font-data text-sm text-obsidian/40 py-20">
            Loading vaults…
          </p>
        )}

        {error && (
          <p className="text-center font-data text-sm text-cinnabar py-8">
            {error}
          </p>
        )}

        {!loading && (
          <>
            <Switchboard
              vaults={vaultEntities}
              onSelectVault={handleSelectVault}
              onCreateVault={
                vaults.length > 0 ? () => setShowCreateModal(true) : undefined
              }
              onGenerateVault={vaults.length === 0 ? handleGenerateVault : undefined}
              activeVaultId={activeVaultId}
              generating={generating}
            />

            {activeVault && unlockedIds.has(activeVault.id) && inboxRecordId && (
              <div className="flex flex-col items-center gap-6 pb-20 px-6">
                <VaultFileUpload
                  vaultId={activeVault.id}
                  recordId={inboxRecordId}
                />
                <a
                  href={`/vault/${activeVault.id}/extract`}
                  className="font-data text-[10px] uppercase tracking-ultra border border-emerald-500/40 text-emerald-500 bg-emerald-500/5 px-6 py-3 hover:bg-emerald-500/10"
                >
                  Open Temporal Extraction Engine →
                </a>
              </div>
            )}
          </>
        )}
      </div>

      {pendingVault && (
        <EncryptionKeyModal
          vault={pendingVault}
          currentKey={getVaultSessionKey(pendingVault.id)}
          onSave={handleKeySave}
          onClose={() => setPendingVault(null)}
        />
      )}

      {savedKeyPrompt && (
        <div className="fixed inset-0 bg-obsidian/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-vellum border border-bone p-8 w-full max-w-md shadow-xl">
            <p className="font-data text-[10px] uppercase tracking-ultra text-emerald-500 mb-2">
              Key Generated Locally
            </p>
            <h2 className="font-head text-xl text-obsidian mb-2">
              Save Your Encryption Key
            </h2>
            <p className="font-data text-xs text-obsidian/55 mb-6 leading-relaxed">
              Your vault <strong>{savedKeyPrompt.vaultName}</strong> is sealed.
              Copy this key to a password manager now — we cannot recover it if
              lost.
            </p>

            <div className="border border-bone bg-bone/10 px-4 py-3 mb-4 font-data text-sm text-obsidian break-all select-all">
              {savedKeyPrompt.key}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={handleCopyGeneratedKey}
                className="font-data text-[10px] uppercase tracking-wider border border-bone px-4 py-2 hover:bg-bone/20"
              >
                {keyCopied ? "Copied" : "Copy key"}
              </button>
              <button
                type="button"
                onClick={() => setSavedKeyPrompt(null)}
                className="font-data text-[10px] uppercase tracking-wider bg-oxford text-vellum px-4 py-2"
              >
                I&apos;ve saved it
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div
          className="fixed inset-0 bg-obsidian/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowCreateModal(false)}
        >
          <form
            className="bg-vellum border border-bone p-8 w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateVault}
          >
            <h2 className="font-head text-xl text-obsidian mb-2">New Vault</h2>
            <p className="font-data text-xs text-obsidian/50 mb-6">
              Choose a name and encryption key. Store the key safely — we cannot
              recover it.
            </p>

            {createError && (
              <p className="font-data text-xs text-cinnabar mb-4">{createError}</p>
            )}

            <label className="block font-data text-[10px] uppercase tracking-ultra text-obsidian/50 mb-1">
              Vault name
            </label>
            <input
              className="w-full border border-bone bg-vellum px-3 py-2 mb-4 font-data text-sm"
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              required
            />

            <label className="block font-data text-[10px] uppercase tracking-ultra text-obsidian/50 mb-1">
              Encryption key
            </label>
            <input
              className="w-full border border-bone bg-vellum px-3 py-2 mb-6 font-data text-sm"
              type="password"
              value={newVaultKey}
              onChange={(e) => setNewVaultKey(e.target.value)}
              minLength={8}
              required
            />

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="font-data text-[10px] uppercase tracking-wider border border-bone px-4 py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="font-data text-[10px] uppercase tracking-wider bg-oxford text-vellum px-4 py-2 disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create vault"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
