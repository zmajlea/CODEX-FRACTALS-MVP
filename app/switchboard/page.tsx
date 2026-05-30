"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Switchboard, { type VaultEntity } from "@/components/Switchboard";
import EncryptionKeyModal from "@/components/EncryptionKeyModal";
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

  const handleCreateVault = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Session expired. Please sign in again.");
      }

      await ensureUserProfile(supabase);

      const { data: vault, error: insertError } = await supabase.rpc(
        "create_vault",
        { p_name: newVaultName.trim() }
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

      await setVaultEncryptionKeyTest(vault.id, newVaultKey, supabase);
      setVaultSessionKey(vault.id, newVaultKey);

      setShowCreateModal(false);
      setNewVaultName("");
      setNewVaultKey("");
      await loadVaults();
      setActiveVaultId(vault.id);
      setUnlockedIds((prev) => new Set(prev).add(vault.id));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const activeVault = vaults.find((v) => v.id === activeVaultId);

  return (
    <div className="min-h-screen bg-vellum">
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-8 py-4 border-b border-bone/40 bg-vellum/90 backdrop-blur-sm">
        <div className="font-head text-lg tracking-wide text-obsidian">
          Fractals · Airlock
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50 hover:text-obsidian"
        >
          Sign out
        </button>
      </header>

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
              onCreateVault={() => setShowCreateModal(true)}
              activeVaultId={activeVaultId}
            />

            {activeVault && unlockedIds.has(activeVault.id) && inboxRecordId && (
              <div className="flex flex-col items-center gap-6 pb-20 px-6">
                <VaultFileUpload
                  vaultId={activeVault.id}
                  recordId={inboxRecordId}
                />
                <a
                  href={`/vault/${activeVault.id}/extract`}
                  className="font-data text-[10px] uppercase tracking-ultra border border-emerald/40 text-emerald bg-emerald/5 px-6 py-3 hover:bg-emerald/10"
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
              Choose a name and encryption key. Store the key safely — we
              cannot recover it.
            </p>

            {createError && (
              <p className="font-data text-xs text-cinnabar mb-4">
                {createError}
              </p>
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
