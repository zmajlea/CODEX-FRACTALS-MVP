-- Per-module white-label branding (CPA sets per enabled module; clients read via grant)

alter table public.distributor_modules
  add column if not exists logo_url text,
  add column if not exists branding jsonb not null default '{}'::jsonb;

-- Seed module rows from tenant-level branding where module branding is still empty
update public.distributor_modules dm
set
  logo_url = coalesce(dm.logo_url, t.logo_url),
  branding = case
    when dm.branding = '{}'::jsonb then
      coalesce(t.branding, '{}'::jsonb)
      || jsonb_strip_nulls(
        jsonb_build_object(
          'data-brand',
          coalesce(t.branding ->> 'data-brand', 'ff3'),
          'wordmark',
          coalesce(
            nullif(trim(t.branding ->> 'wordmark'), ''),
            nullif(trim(t.name), ''),
            'Financial Firefighter'
          )
        )
      )
    else dm.branding
  end
from public.tenants t
where t.id = dm.distributor_tenant_id;

create or replace function public.normalize_module_branding(p_branding jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_branding jsonb := coalesce(p_branding, '{}'::jsonb);
  v_preset text;
begin
  v_preset := nullif(trim(v_branding ->> 'data-brand'), '');

  if v_preset is not null and v_preset not in (
    'ff1', 'ff2', 'ff3', 'ff4', 'fractals', 'summit'
  ) then
    raise exception 'Invalid data-brand preset: %', v_preset;
  end if;

  if v_branding ? 'wordmark' then
    v_branding := v_branding || jsonb_build_object(
      'wordmark', left(trim(v_branding ->> 'wordmark'), 120)
    );
  end if;

  if v_branding ? '--brand' then
    v_branding := v_branding || jsonb_build_object(
      '--brand', left(trim(v_branding ->> '--brand'), 32)
    );
  end if;

  return v_branding;
end;
$$;

create or replace function public.set_distributor_module_branding(
  p_tenant_id uuid,
  p_module_slug text,
  p_branding jsonb default '{}'::jsonb,
  p_logo_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module public.modules;
  v_row public.distributor_modules;
  v_branding jsonb;
  v_logo text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_distributor(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  select * into v_module
  from public.modules
  where slug = p_module_slug
    and status in ('active', 'beta');

  if not found then
    raise exception 'Module not found';
  end if;

  if not exists (
    select 1
    from public.distributor_modules dm
    where dm.distributor_tenant_id = p_tenant_id
      and dm.module_id = v_module.id
      and dm.allowed = true
  ) then
    raise exception 'Module not enabled for this firm';
  end if;

  v_branding := public.normalize_module_branding(p_branding);
  v_logo := nullif(trim(p_logo_url), '');

  update public.distributor_modules dm
  set
    branding = v_branding,
    logo_url = v_logo
  where dm.distributor_tenant_id = p_tenant_id
    and dm.module_id = v_module.id
  returning * into v_row;

  insert into public.platform_audit_events (
    actor_id, actor_tier, action, target_type, target_id, payload
  )
  values (
    auth.uid(),
    case when public.is_global_admin() then 'global_admin' else 'distributor' end,
    'set_distributor_module_branding',
    'distributor_module',
    v_row.distributor_tenant_id::text || ':' || v_module.slug,
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'module_slug', p_module_slug,
      'data_brand', v_branding ->> 'data-brand',
      'has_logo', v_logo is not null
    )
  );

  return jsonb_build_object(
    'tenant_id', v_row.distributor_tenant_id,
    'module_slug', v_module.slug,
    'module_name', v_module.name,
    'logo_url', v_row.logo_url,
    'branding', v_row.branding
  );
end;
$$;

create or replace function public.get_client_module_branding(p_grant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_grant public.client_module_access;
  v_tenant public.tenants;
  v_dm public.distributor_modules;
  v_module public.modules;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_grant
  from public.client_module_access
  where id = p_grant_id
    and client_user_id = v_user
    and status = 'active';

  if not found then
    raise exception 'Grant not found';
  end if;

  select * into v_module from public.modules where id = v_grant.module_id;
  select * into v_tenant from public.tenants where id = v_grant.distributor_tenant_id;

  select * into v_dm
  from public.distributor_modules dm
  where dm.distributor_tenant_id = v_grant.distributor_tenant_id
    and dm.module_id = v_grant.module_id
    and dm.allowed = true;

  return jsonb_build_object(
    'grant_id', v_grant.id,
    'module_slug', v_module.slug,
    'module_name', v_module.name,
    'tenant_id', v_tenant.id,
    'tenant_name', v_tenant.name,
    'tenant_branding', coalesce(v_tenant.branding, '{}'::jsonb),
    'tenant_logo_url', v_tenant.logo_url,
    'tenant_brand_color_hex', v_tenant.brand_color_hex,
    'module_branding', coalesce(v_dm.branding, '{}'::jsonb),
    'module_logo_url', v_dm.logo_url
  );
end;
$$;

create or replace function public.list_distributor_modules(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_distributor(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'slug', m.slug,
          'name', m.name,
          'status', m.status,
          'logo_url', dm.logo_url,
          'branding', coalesce(dm.branding, '{}'::jsonb)
        )
        order by m.name
      )
      from public.distributor_modules dm
      join public.modules m on m.id = dm.module_id
      where dm.distributor_tenant_id = p_tenant_id
        and dm.allowed = true
        and m.status in ('active', 'beta')
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.set_distributor_module_branding(uuid, text, jsonb, text) to authenticated;
grant execute on function public.get_client_module_branding(uuid) to authenticated;
