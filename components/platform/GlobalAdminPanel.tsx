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
      setMsg("Distributor created");
      setName("");
      setSlug("");
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={createTenant} className="border border-bone rounded-xl p-6 bg-white">
        <h2 className="font-head text-lg mb-4">Create distributor</h2>
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
          Create
        </button>
        {msg && <p className="text-sm text-emerald-700 mt-3">{msg}</p>}
        {err && <p className="text-sm text-red-700 mt-3">{err}</p>}
      </form>

      <div className="border border-bone rounded-xl p-6 bg-white overflow-x-auto">
        <h2 className="font-head text-lg mb-4">Distributors</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-codex-muted border-b border-bone">
              <th className="pb-2 pr-4">Firm</th>
              <th className="pb-2 pr-4">Slug</th>
              <th className="pb-2">Credits</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-bone/50">
                <td className="py-2 pr-4">{t.name}</td>
                <td className="py-2 pr-4">{t.domain_slug}</td>
                <td className="py-2">{t.credit_balance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
