import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { CLIENT_LOGIN } from "@/lib/auth/login-flow";

export default async function ClientHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(CLIENT_LOGIN);

  const cookieStore = await cookies();
  const activeGrantId = cookieStore.get("active_grant_id")?.value;

  const { data: grants } = await supabase
    .from("client_module_access")
    .select("id, modules(route_base, name)")
    .eq("client_user_id", user.id)
    .eq("status", "active")
    .order("granted_at", { ascending: false });

  const grantList = grants ?? [];
  const active =
    grantList.find((g) => g.id === activeGrantId) ?? grantList[0] ?? null;

  const mod = active?.modules as { route_base: string; name: string } | null;
  if (mod?.route_base) {
    redirect(`/client${mod.route_base}`);
  }

  return (
    <div className="max-w-lg mx-auto p-8 text-center">
      <h1 className="font-head text-2xl mb-3">No modules yet</h1>
      <p className="text-sm text-codex-muted mb-6">
        Your account is ready. Ask your operator for an invite link, or wait for them to provision a seat.
      </p>
      <Link href={CLIENT_LOGIN} className="text-sm text-oxford underline">
        Back to client login
      </Link>
    </div>
  );
}
