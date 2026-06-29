import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import "@/app/ff/ff-v1.css";

export default async function GlobalAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin");
  }

  const { data: routeData } = await supabase.rpc("get_ff_login_route");
  const role =
    routeData &&
    typeof routeData === "object" &&
    "role" in routeData &&
    routeData.role === "global_admin"
      ? "global_admin"
      : null;

  if (!role) {
    const fallback =
      routeData &&
      typeof routeData === "object" &&
      "route" in routeData &&
      typeof routeData.route === "string"
        ? routeData.route
        : "/switchboard";
    redirect(fallback);
  }

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name, domain_slug, brand_color_hex, available_credits")
    .order("name");

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-xs uppercase tracking-wide text-codex-muted mb-2">
        CodexOne · Tier 1
      </p>
      <h1 className="font-head text-3xl text-obsidian mb-2">Global Admin</h1>
      <p className="text-sm text-codex-muted mb-8">
        Distributor tenant registry. Full create-tenant UI ships in Phase 3.
      </p>

      <div className="ff-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-codex-muted border-b border-bone">
              <th className="pb-2 pr-4 font-medium">Firm</th>
              <th className="pb-2 pr-4 font-medium">Domain slug</th>
              <th className="pb-2 pr-4 font-medium">Credits</th>
              <th className="pb-2 font-medium">Brand</th>
            </tr>
          </thead>
          <tbody>
            {(tenants ?? []).map((t) => (
              <tr key={t.id} className="border-b border-bone/60 last:border-0">
                <td className="py-3 pr-4">{t.name}</td>
                <td className="py-3 pr-4">
                  <a
                    href={`/${t.domain_slug}/admin`}
                    className="text-cinnabar hover:underline"
                  >
                    {t.domain_slug}
                  </a>
                </td>
                <td className="py-3 pr-4">{t.available_credits}</td>
                <td className="py-3">
                  <span
                    className="inline-block h-4 w-4 rounded-full border border-bone"
                    style={{ background: t.brand_color_hex ?? "#E67E50" }}
                    title={t.brand_color_hex ?? undefined}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(tenants ?? []).length === 0 && (
          <p className="text-sm text-codex-muted py-4">No distributors yet.</p>
        )}
      </div>
    </div>
  );
}
