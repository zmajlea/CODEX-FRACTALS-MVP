import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { canAccessModule, getTier } from "@/lib/auth/rbac";
import type { Database } from "@/lib/database.types";

export type BcnVaultAccess = {
  ownerUserId: string;
};

export async function resolveBcnVaultAccess(
  supabase: SupabaseClient<Database>,
  userId: string,
  vaultId: string
): Promise<BcnVaultAccess | null> {
  const { data: vault } = await supabase
    .from("vaults")
    .select("id, created_by")
    .eq("id", vaultId)
    .maybeSingle();

  if (!vault) return null;

  const { data: grant } = await supabase
    .from("client_module_access")
    .select("client_user_id, distributor_tenant_id, module_id, modules(slug)")
    .eq("vault_id", vaultId)
    .eq("status", "active")
    .maybeSingle();

  const moduleSlug = (grant?.modules as { slug?: string } | null)?.slug;
  const ownerUserId = grant?.client_user_id ?? vault.created_by;
  if (!ownerUserId) return null;

  if (userId === ownerUserId) {
    const ok = await canAccessModule(supabase, userId, "bcn");
    if (ok) return { ownerUserId };
  }

  const { data: member } = await supabase
    .from("vault_members")
    .select("user_id")
    .eq("vault_id", vaultId)
    .eq("user_id", userId)
    .maybeSingle();

  if (member) {
    return { ownerUserId };
  }

  if (grant?.distributor_tenant_id) {
    const { data: isOp } = await supabase.rpc("is_operator", {
      p_tenant_id: grant.distributor_tenant_id,
    });
    if (isOp && moduleSlug === "bcn") return { ownerUserId };
  }

  const tier = await getTier(supabase, userId);
  if (tier === "global_admin") return { ownerUserId };

  return null;
}
