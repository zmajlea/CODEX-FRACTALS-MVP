"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { resolveGate } from "@/lib/gating";
import { useActiveVault } from "@/lib/context/active-vault";
import { createClient } from "@/utils/supabase/client";

export default function RecordSettingsPage() {
  const params = useParams();
  const vaultId = params.vaultId as string;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { isUnlocked } = useActiveVault();
  const [role, setRole] = useState<string | null>(null);
  const [vaultName, setVaultName] = useState("");
  const [members, setMembers] = useState<
    { email: string; role: string; user_id: string }[]
  >([]);
  const [inviteEmail, setInviteEmail] = useState("");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase
        .from("vault_members")
        .select("role, vaults(name)")
        .eq("vault_id", vaultId)
        .eq("user_id", user.id)
        .single();
      setRole(membership?.role ?? null);
      const v = membership?.vaults as { name: string } | null;
      setVaultName(v?.name ?? "");
      const { data: mems } = await supabase
        .from("vault_members")
        .select("role, user_id, users(email)")
        .eq("vault_id", vaultId);
      setMembers(
        (mems ?? []).map((m) => ({
          role: m.role as string,
          user_id: m.user_id,
          email: (m.users as { email: string } | null)?.email ?? "—",
        }))
      );
    })();
  }, [supabase, vaultId]);

  const gate = resolveGate({
    allowed: role === "ADMIN" || role === "SUPER_ADMIN",
    disabledReason:
      role && role !== "ADMIN" && role !== "SUPER_ADMIN"
        ? "Record Settings require Admin role."
        : undefined,
  });

  const handleInvite = async () => {
    if (gate.kind !== "allowed" || !inviteEmail.trim()) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("vault_invites").insert({
      vault_id: vaultId,
      email: inviteEmail.trim(),
      role: "USER",
      invited_by: user?.id ?? null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("record_activity_events").insert({
      vault_id: vaultId,
      event_type: "invite_sent",
      actor_id: user?.id ?? null,
      payload: { email: inviteEmail.trim() },
    });
    setInviteEmail("");
  };

  if (gate.kind === "disabled") {
    return (
      <div className="max-w-lg mx-auto py-20 px-6 text-center">
        <p className="font-data text-sm text-obsidian/60">{gate.reason}</p>
        <button
          type="button"
          onClick={() => router.push(`/vault/${vaultId}`)}
          className="mt-6 font-data text-[10px] uppercase border border-bone px-4 py-2"
        >
          Back to Record Home
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="font-head text-2xl mb-2">Record Settings</h1>
      <p className="font-data text-xs text-obsidian/50 mb-8">{vaultName}</p>

      <section className="border border-bone mb-8">
        <h2 className="font-data text-[10px] uppercase tracking-ultra px-4 py-3 border-b border-bone text-obsidian/50">
          Key posture
        </h2>
        <p className="px-4 py-4 font-data text-sm">
          {isUnlocked(vaultId) ? "Active · Key in session" : "Locked"}
        </p>
      </section>

      <section className="border border-bone mb-8">
        <h2 className="font-data text-[10px] uppercase tracking-ultra px-4 py-3 border-b border-bone text-obsidian/50">
          Members &amp; Roles
        </h2>
        {members.map((m) => (
          <div
            key={m.user_id}
            className="px-4 py-3 border-b border-bone/40 font-data text-xs flex justify-between"
          >
            <span>{m.email}</span>
            <span className="uppercase text-obsidian/50">{m.role}</span>
          </div>
        ))}
        <div className="px-4 py-4 flex gap-2">
          <input
            className="flex-1 border-b border-dashed border-bone bg-transparent font-data text-sm py-1"
            placeholder="Invite email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <button
            type="button"
            onClick={handleInvite}
            className="font-data text-[10px] uppercase bg-oxford text-vellum px-3 py-1"
          >
            Invite
          </button>
        </div>
      </section>
    </div>
  );
}
