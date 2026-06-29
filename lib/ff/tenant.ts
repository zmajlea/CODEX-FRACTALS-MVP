import { createClient } from "@/utils/supabase/server";

export type TenantBranding = {
  id: string;
  name: string;
  subdomain: string;
  logo_url: string | null;
  brand_color_hex: string | null;
  available_credits: number;
};

export async function getTenantByDomain(
  domain: string
): Promise<TenantBranding | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, subdomain, logo_url, brand_color_hex, available_credits")
    .eq("subdomain", domain.toLowerCase())
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export async function isTenantAdmin(
  tenantId: string,
  userId: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenant_members")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role", "ADMIN")
    .maybeSingle();

  return Boolean(data);
}
