import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export default async function ClientHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: grant } = await supabase
    .from("client_module_access")
    .select("modules(route_base)")
    .eq("client_user_id", user.id)
    .eq("status", "active")
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const routeBase = (grant?.modules as { route_base: string } | null)?.route_base;
  redirect(routeBase ? `/client${routeBase}` : "/login");
}
