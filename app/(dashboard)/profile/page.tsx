"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

export default function ProfileSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [auditEvents, setAuditEvents] = useState<
    { event_type: string; created_at: string }[]
  >([]);
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? "");
      const { data: profile } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", user.id)
        .single();
      setDisplayName(profile?.display_name ?? "");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: events } = await (supabase as any)
        .from("user_audit_events")
        .select("event_type, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setAuditEvents(events ?? []);
    })();
  }, [supabase]);

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="font-head text-2xl mb-8">Profile Settings</h1>

      <section className="border border-bone mb-8">
        <h2 className="font-data text-[10px] uppercase tracking-ultra px-4 py-3 border-b border-bone text-obsidian/50">
          Identity
        </h2>
        <div className="px-4 py-4 space-y-3 font-data text-sm">
          <p>{displayName || "—"}</p>
          <p className="text-obsidian/60">{email}</p>
        </div>
      </section>

      <section className="border border-bone mb-8">
        <h2 className="font-data text-[10px] uppercase tracking-ultra px-4 py-3 border-b border-bone text-obsidian/50">
          Authorities
        </h2>
        <p className="px-4 py-4 font-data text-xs text-obsidian/50">
          Delegated by me / Granted to me — configure in a future release pass.
        </p>
      </section>

      <button
        type="button"
        onClick={() => setShowAudit((v) => !v)}
        className="font-data text-[10px] uppercase border border-bone px-4 py-2"
      >
        {showAudit ? "Hide" : "View"} User Audit Log
      </button>

      {showAudit && (
        <div className="mt-4 border border-bone">
          {auditEvents.length === 0 ? (
            <p className="px-4 py-6 font-data text-xs text-obsidian/40 text-center">
              No audit events yet.
            </p>
          ) : (
            auditEvents.map((e, i) => (
              <div
                key={i}
                className="px-4 py-3 border-b border-bone/40 font-data text-xs flex justify-between"
              >
                <span className="uppercase">{e.event_type}</span>
                <span className="text-obsidian/50">
                  {e.created_at.slice(0, 19)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
