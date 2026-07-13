-- Auto-enable active modules when global admin creates a distributor tenant
create or replace function public.create_distributor_tenant(
  p_name text,
  p_domain_slug text,
  p_brand_color_hex text default '#E67E50',
  p_logo_url text default null,
  p_initial_credits integer default 0
)
returns public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants;
  v_slug text := lower(trim(p_domain_slug));
begin
  if not public.is_global_admin() then
    raise exception 'Not authorized: global_admin required';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Tenant name is required';
  end if;

  if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'Invalid domain_slug';
  end if;

  insert into public.tenants (
    name,
    domain_slug,
    brand_color_hex,
    logo_url,
    available_credits
  )
  values (
    trim(p_name),
    v_slug,
    coalesce(nullif(trim(p_brand_color_hex), ''), '#E67E50'),
    nullif(trim(p_logo_url), ''),
    greatest(coalesce(p_initial_credits, 0), 0)
  )
  returning * into v_tenant;

  insert into public.distributor_modules (distributor_tenant_id, module_id, allowed)
  select v_tenant.id, m.id, true
  from public.modules m
  where m.status in ('active', 'beta')
  on conflict do nothing;

  if coalesce(p_initial_credits, 0) > 0 then
    insert into public.credit_transactions (tenant_id, amount, action, metadata)
    values (
      v_tenant.id,
      p_initial_credits,
      'purchase',
      jsonb_build_object('source', 'global_admin_create')
    );
  end if;

  return v_tenant;
end;
$$;
