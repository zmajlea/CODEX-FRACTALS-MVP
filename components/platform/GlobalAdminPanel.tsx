"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

type Tenant = {
  id: string;
  name: string;
  domain_slug: string;
  credit_balance: number;
  brand_color_hex: string | null;
};

type Props = {
  tenants: Tenant[];
  billingRules: { id: string; scope: string; payer: string; credit_cost: number }[];
};

export function GlobalAdminPanel({ tenants, billingRules }: Props) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [credits, setCredits] = useState("10");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [inviteTenantId, setInviteTenantId] = useState(tenants[0]?.id ?? "");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [adminInviteEmail, setAdminInviteEmail] = useState("");
  const [adminInviteUrl, setAdminInviteUrl] = useState<string | null>(null);

  async function createTenant(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const { error } = await supabase.rpc("create_distributor_tenant", {
      p_name: name.trim(),
      p_domain_slug: slug.trim().toLowerCase(),
      p_initial_credits: parseInt(credits, 10) || 0,
    });
    if (error) setErr(error.message);
    else {
      setMsg("Operator created");
      setName("");
      setSlug("");
    }
  }

  async function inviteDistributor(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInviteUrl(null);
    const { data, error } = await supabase.rpc("invite_distributor_staff", {
      p_tenant_id: inviteTenantId,
      p_email: inviteEmail.trim(),
    });
    if (error) {
      setErr(error.message);
      return;
    }
    const token = (data as { invite_token?: string } | null)?.invite_token;
    if (token) {
      setInviteUrl(`${window.location.origin}/portal/login?invite=${token}`);
      setInviteEmail("");
      setMsg("Operator invite created");
    }
  }

  async function inviteGlobalAdmin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setAdminInviteUrl(null);
    const { data, error } = await supabase.rpc("invite_global_admin_staff", {
      p_email: adminInviteEmail.trim(),
    });
    if (error) {
      setErr(error.message);
      return;
    }
    const token = (data as { invite_token?: string } | null)?.invite_token;
    if (token) {
      setAdminInviteUrl(`${window.location.origin}/portal/login?invite=${token}`);
      setAdminInviteEmail("");
      setMsg("Global admin invite created");
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={createTenant} className="border border-bone rounded-xl p-6 bg-white">
        <h2 className="font-head text-lg mb-4">Create operator (Randall firm)</h2>
        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          <input
            className="border border-bone rounded-lg px-3 py-2"
            placeholder="Firm name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="border border-bone rounded-lg px-3 py-2"
            placeholder="domain_slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
          />
          <input
            className="border border-bone rounded-lg px-3 py-2"
            type="number"
            placeholder="Credits"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
          />
        </div>
        <button type="submit" className="px-4 py-2 rounded-lg bg-oxford text-white text-sm">
          Create firm
        </button>
      </form>

      <form onSubmit={inviteDistributor} className="border border-bone rounded-xl p-6 bg-white">
        <h2 className="font-head text-lg mb-2">Invite Randall advisor</h2>
        <p className="text-sm text-codex-muted mb-4">
          Sends a portal invite. They create a staff account, then land on /operator.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <select
            className="border border-bone rounded-lg px-3 py-2"
            value={inviteTenantId}
            onChange={(e) => setInviteTenantId(e.target.value)}
            required
          >
            {tenants
              .filter((t) => !t.domain_slug.startsWith("codexone"))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.domain_slug})
                </option>
              ))}
          </select>
          <input
            className="border border-bone rounded-lg px-3 py-2"
            type="email"
            placeholder="advisor@firm.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="px-4 py-2 rounded-lg bg-oxford text-white text-sm">
          Create invite link
        </button>
        {inviteUrl && (
          <p className="text-sm mt-3 break-all text-emerald-800 bg-emerald-50 p-3 rounded-lg">
            {inviteUrl}
          </p>
        )}
      </form>

      <form onSubmit={inviteGlobalAdmin} className="border border-bone rounded-xl p-6 bg-white">
        <h2 className="font-head text-lg mb-2">Invite CodexOne admin</h2>
        <p className="text-sm text-codex-muted mb-4">
          Non-@codexone.io emails need an explicit invite. @codexone.io can still sign in directly.
        </p>
        <div className="flex gap-3 mb-4">
          <input
            className="flex-1 border border-bone rounded-lg px-3 py-2"
            type="email"
            placeholder="admin@codexone.io"
            value={adminInviteEmail}
            onChange={(e) => setAdminInviteEmail(e.target.value)}
            required
          />
          <button type="submit" className="px-4 py-2 rounded-lg bg-oxford text-white text-sm shrink-0">
            Invite
          </button>
        </div>
        {adminInviteUrl && (
          <p className="text-sm break-all text-emerald-800 bg-emerald-50 p-3 rounded-lg">
            {adminInviteUrl}
          </p>
        )}
      </form>

      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      {err && <p className="text-sm text-red-700">{err}</p>}

      <div className="border border-bone rounded-xl p-6 bg-white">
        <h2 className="font-head text-lg mb-4">Billing rules</h2>
        <ul className="text-sm space-y-2">
          {billingRules.map((r) => (
            <li key={r.id}>
              {r.scope} · {r.payer} · {r.credit_cost} credit(s)
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
