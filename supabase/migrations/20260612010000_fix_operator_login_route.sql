-- Post-rename: staff portal login route must resolve operator role (legacy distributor supported).

create or replace function public.get_ff_login_route()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_grant record;
  v_dist record;
begin
  if v_user is null then
    return jsonb_build_object('route', '/login');
  end if;

  if public.is_global_admin() then
    return jsonb_build_object('route', '/admin', 'role', 'global_admin');
  end if;

  select ur.tenant_id, t.domain_slug
  into v_dist
  from public.user_roles ur
  join public.tenants t on t.id = ur.tenant_id
  where ur.user_id = v_user
    and ur.role::text in ('operator', 'distributor')
  order by ur.created_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'route', '/operator',
      'role', 'operator',
      'tenant_id', v_dist.tenant_id,
      'domain_slug', v_dist.domain_slug
    );
  end if;

  select
    cma.id as grant_id,
    m.slug as module_slug,
    m.route_base,
    t.domain_slug,
    cma.distributor_tenant_id
  into v_grant
  from public.client_module_access cma
  join public.modules m on m.id = cma.module_id
  join public.tenants t on t.id = cma.distributor_tenant_id
  where cma.client_user_id = v_user
    and cma.status = 'active'
  order by cma.granted_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'route', '/client' || v_grant.route_base,
      'role', 'client',
      'grant_id', v_grant.grant_id,
      'module_slug', v_grant.module_slug,
      'domain_slug', v_grant.domain_slug,
      'tenant_id', v_grant.distributor_tenant_id
    );
  end if;

  return jsonb_build_object('route', '/login', 'role', 'none');
end;
$$;

grant execute on function public.get_ff_login_route() to authenticated;

create or replace function public.is_operator(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role::text in ('operator', 'distributor')
      and ur.tenant_id = p_tenant_id
  );
$$;

grant execute on function public.is_operator(uuid) to authenticated;
