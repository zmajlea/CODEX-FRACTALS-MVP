-- Backfill distributor_modules for existing firms + admin module toggle RPC

insert into public.distributor_modules (distributor_tenant_id, module_id, allowed)
select t.id, m.id, true
from public.tenants t
cross join public.modules m
where m.status in ('active', 'beta')
  and coalesce(t.is_house, false) = false
  and not exists (
    select 1
    from public.distributor_modules dm
    where dm.distributor_tenant_id = t.id
      and dm.module_id = m.id
  )
on conflict do nothing;

-- Client-only login route (ignores distributor / global_admin hats)
create or replace function public.get_client_login_route()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_grant record;
begin
  if v_user is null then
    return jsonb_build_object('route', '/client/login', 'role', 'none');
  end if;

  select
    cma.id as grant_id,
    m.slug as module_slug,
    m.route_base
  into v_grant
  from public.client_module_access cma
  join public.modules m on m.id = cma.module_id
  where cma.client_user_id = v_user
    and cma.status = 'active'
  order by cma.granted_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'route', '/client' || v_grant.route_base,
      'role', 'client',
      'grant_id', v_grant.grant_id,
      'module_slug', v_grant.module_slug
    );
  end if;

  return jsonb_build_object('route', '/client/login', 'role', 'none');
end;
$$;

create or replace function public.set_distributor_module(
  p_tenant_id uuid,
  p_module_slug text,
  p_allowed boolean
)
returns public.distributor_modules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module public.modules;
  v_row public.distributor_modules;
begin
  if not public.is_global_admin() then
    raise exception 'Not authorized: global_admin required';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant not found';
  end if;

  select * into v_module
  from public.modules
  where slug = p_module_slug and status in ('active', 'beta');

  if not found then
    raise exception 'Module not found';
  end if;

  insert into public.distributor_modules (
    distributor_tenant_id, module_id, allowed
  )
  values (p_tenant_id, v_module.id, p_allowed)
  on conflict (distributor_tenant_id, module_id)
  do update set allowed = excluded.allowed
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.get_client_login_route() to authenticated;
grant execute on function public.set_distributor_module(uuid, text, boolean) to authenticated;
