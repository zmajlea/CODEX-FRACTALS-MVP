"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Switchboard, { type VaultEntity } from "@/components/Switchboard";
import EncryptionKeyModal from "@/components/EncryptionKeyModal";
import VaultFileUpload from "@/components/VaultFileUpload";
import ResultsModeDrawer from "@/components/ResultsModeDrawer";
import { setVaultEncryptionKeyTest } from "@/lib/encryption";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { useActiveVault } from "@/lib/context/active-vault";
import {
  clearVaultSessionKey,
  getVaultSessionKey,
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
  const {
    activeVault,
    setActiveVault,
    isUnlocked,
    unlockVault,
    lockVault,
  } = useActiveVault();

  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingVault, setPendingVault] = useState<VaultSummary | null>(null);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  const [resultsMode, setResultsMode] = useState(false);
  const [scopeVaultIds, setScopeVaultIds] = useState<Set<string>>(new Set());

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
  const [inboxRecordId, setInboxRecordId] = useState<string | null>(null);

  const refreshUnlocked = useCallback((vaultList: VaultSummary[]) => {
    const ids = new Set<string>();
    for (const v of vaultList) {
      if (isUnlocked(v.id)) ids.add(v.id);
    }
    setUnlockedIds(ids);
    setScopeVaultIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
      }
      if (next.size === 0) return ids;
      return next;
    });
  }, [isUnlocked]);

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
      .select("role, vault_id, vaults ( id, name, created_by, encryption_test )")
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

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("results") === "1") setResultsMode(true);
    }
  }, []);

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
      if (insertError || !data) return null;
      setInboxRecordId(data.id);
      return data.id;
    },
    [supabase]
  );

  useEffect(() => {
    if (activeVault && isUnlocked(activeVault.id)) {
      ensureInboxRecord(activeVault.id);
    }
  }, [activeVault, isUnlocked, ensureInboxRecord]);

  const vaultEntities: VaultEntity[] = vaults.map((v) => ({
    id: v.id,
    name: v.name,
    unlocked: unlockedIds.has(v.id),
  }));

  const handleSelectVault = (vault: VaultEntity) => {
    const full = vaults.find((v) => v.id === vault.id);
    if (!full) return;
    if (vault.unlocked) {
      setActiveVault({ id: vault.id, name: vault.name });
      router.push(`/vault/${vault.id}`);
      return;
    }
    setPendingVault(full);
  };

  const handleKeySave = (key: string | null) => {
    if (!pendingVault) return;
    if (key) {
      unlockVault(pendingVault.id, key);
      setUnlockedIds((prev) => new Set(prev).add(pendingVault.id));
      setActiveVault({ id: pendingVault.id, name: pendingVault.name });
      router.push(`/vault/${pendingVault.id}`);
    } else {
      lockVault(pendingVault.id);
      setUnlockedIds((prev) => {
        const next = new Set(prev);
        next.delete(pendingVault.id);
        return next;
      });
      if (activeVault?.id === pendingVault.id) {
        setActiveVault(null);
        setInboxRecordId(null);
      }
    }
  };

  const createVaultWithKey = async (name: string, key: string) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Session expired. Please sign in again.");
    await ensureUserProfile(supabase);
    const { data: vault, error: insertError } = await supabase.rpc(
      "create_vault",
      { p_name: name.trim() }
    );
    if (insertError || !vault) {
      throw new Error(insertError?.message ?? "Failed to create vault");
    }
    await setVaultEncryptionKeyTest(vault.id, key, supabase);
    unlockVault(vault.id, key);
    await loadVaults();
    setActiveVault({ id: vault.id, name: vault.name });
    return { id: vault.id, name: vault.name };
  };

  const handleGenerateVault = async () => {
    setCreateError(null);
    setGenerating(true);
    try {
      const key = generateSecureKey();
      const vault = await createVaultWithKey("Sovereign Archive", key);
      setSavedKeyPrompt({ vaultId: vault.id, vaultName: vault.name, key });
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

  const toggleScopeVault = (vaultId: string) => {
    setScopeVaultIds((prev) => {
      const next = new Set(prev);
      if (next.has(vaultId)) next.delete(vaultId);
      else next.add(vaultId);
      return next;
    });
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between px-8 py-4 border-b border-bone/30">
        <div>
          <h1 className="font-head text-xl text-obsidian tracking-wide">
            Gateway
          </h1>
          <p className="font-data text-[10px] uppercase tracking-ultra text-obsidian/40 mt-1">
            Portfolio · {unlockedIds.size} active records
          </p>
        </div>
        <button
          type="button"
          onClick={() => setResultsMode((v) => !v)}
          className={
            "font-data text-[10px] uppercase tracking-ultra px-4 py-2 border transition-colors " +
            (resultsMode
              ? "border-cinnabar text-cinnabar bg-cinnabar/5"
              : "border-bone text-obsidian/60 hover:border-obsidian/30")
          }
        >
          {resultsMode ? "Results Mode ON" : "Results Mode OFF"}
        </button>
      </div>

      {loading && (
        <p className="text-center font-data text-sm text-obsidian/40 py-20">
          Loading records…
        </p>
      )}
      {error && (
        <p className="text-center font-data text-sm text-cinnabar py-8">
          {error}
        </p>
      )}

      {!loading && (
        <div className={resultsMode ? "pr-[min(420px,40vw)]" : ""}>
          <Switchboard
            vaults={vaultEntities}
            onSelectVault={handleSelectVault}
            onCreateVault={
              vaults.length > 0 ? () => setShowCreateModal(true) : undefined
            }
            onGenerateVault={vaults.length === 0 ? handleGenerateVault : undefined}
            activeVaultId={activeVault?.id ?? null}
            generating={generating}
          />

          {activeVault && isUnlocked(activeVault.id) && inboxRecordId && (
            <div className="flex flex-col items-center gap-6 pb-20 px-6">
              <VaultFileUpload
                vaultId={activeVault.id}
                recordId={inboxRecordId}
              />
            </div>
          )}
        </div>
      )}

      <ResultsModeDrawer
        isOpen={resultsMode}
        onClose={() => setResultsMode(false)}
        vaultsLoading={loading}
        eligibleVaultIds={unlockedIds}
        scopeVaultIds={scopeVaultIds}
        onToggleScope={toggleScopeVault}
        vaultNames={Object.fromEntries(vaults.map((v) => [v.id, v.name]))}
      />

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
            <h2 className="font-head text-xl text-obsidian mb-4">
              Save Your Encryption Key
            </h2>
            <div className="border border-bone bg-bone/10 px-4 py-3 mb-4 font-data text-sm break-all">
              {savedKeyPrompt.key}
            </div>
            <button
              type="button"
              onClick={() => setSavedKeyPrompt(null)}
              className="font-data text-[10px] uppercase bg-oxford text-vellum px-4 py-2"
            >
              I&apos;ve saved it
            </button>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-obsidian/40 flex items-center justify-center z-50 p-4">
          <form
            className="bg-vellum border border-bone p-8 w-full max-w-md"
            onSubmit={handleCreateVault}
          >
            <h2 className="font-head text-xl mb-4">New Record</h2>
            {createError && (
              <p className="font-data text-xs text-cinnabar mb-4">{createError}</p>
            )}
            <input
              className="w-full border border-bone px-3 py-2 mb-4 font-data text-sm"
              placeholder="Record name"
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              required
            />
            <input
              className="w-full border border-bone px-3 py-2 mb-6 font-data text-sm"
              type="password"
              placeholder="Encryption key"
              value={newVaultKey}
              onChange={(e) => setNewVaultKey(e.target.value)}
              minLength={8}
              required
            />
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="font-data text-[10px] uppercase border border-bone px-4 py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="font-data text-[10px] uppercase bg-oxford text-vellum px-4 py-2"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
