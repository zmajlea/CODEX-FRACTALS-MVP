import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { requireTier } from "@/lib/auth/rbac";
import { SignOutButton } from "@/components/auth/SignOutButton";
import "@/app/styles/fractals.css";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`${PORTAL_LOGIN}?next=/admin`);

  await requireTier(supabase, user.id, ["global_admin"]);

  return (
    <div className="min-h-screen bg-vellum text-obsidian">
      <header className="border-b border-bone px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-codex-muted">CodexOne · Tier 1</p>
          <span className="font-head text-lg">Global Admin</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-codex-muted hidden sm:inline">{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
