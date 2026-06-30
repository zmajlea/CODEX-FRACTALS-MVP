import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { requireTier } from "@/lib/auth/rbac";
import "@/app/styles/fractals.css";

export default async function DistributorLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/distributor");

  await requireTier(supabase, user.id, ["distributor", "global_admin"]);

  return (
    <div className="min-h-screen bg-vellum text-obsidian">
      <header className="border-b border-bone px-6 py-4 flex items-center justify-between">
        <span className="font-head text-lg">Distributor Console</span>
        <nav className="text-sm flex gap-4">
          <a href="/distributor">Clients</a>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
