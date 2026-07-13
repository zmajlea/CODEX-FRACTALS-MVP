-- Module branding: active skin (ff1|ff2|ff3|custom) + persisted custom slot.

create or replace function public.normalize_module_branding(p_branding jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_branding jsonb := coalesce(p_branding, '{}'::jsonb);
  v_preset text;
  v_custom jsonb;
  v_base text;
  v_key text;
  v_val text;
  v_allowed text[] := array[
    '--brand', '--brand-2', '--seal', '--foil',
    '--canvas', '--paper', '--ink', '--cinnabar'
  ];
begin
  v_preset := nullif(trim(v_branding ->> 'data-brand'), '');

  if v_preset is not null and v_preset not in (
    'ff1', 'ff2', 'ff3', 'ff4', 'fractals', 'summit', 'custom'
  ) then
    raise exception 'Invalid data-brand preset: %', v_preset;
  end if;

  if v_branding ? 'custom' then
    v_custom := coalesce(v_branding -> 'custom', '{}'::jsonb);

    v_base := nullif(trim(v_custom ->> 'base'), '');
    if v_base is not null and v_base not in ('ff1', 'ff2', 'ff3') then
      raise exception 'Invalid custom.base preset: %', v_base;
    end if;

    if v_custom ? 'wordmark' then
      v_custom := v_custom || jsonb_build_object(
        'wordmark', left(trim(v_custom ->> 'wordmark'), 120)
      );
    end if;

    if v_custom ? 'logo_url' then
      v_custom := v_custom || jsonb_build_object(
        'logo_url', left(nullif(trim(v_custom ->> 'logo_url'), ''), 2048)
      );
      if v_custom ->> 'logo_url' is null then
        v_custom := v_custom - 'logo_url';
      end if;
    end if;

    foreach v_key in array v_allowed loop
      if v_custom ? v_key then
        v_val := nullif(trim(v_custom ->> v_key), '');
        if v_val is not null then
          if v_val !~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$' then
            raise exception 'Invalid color for custom.%: %', v_key, v_val;
          end if;
          v_custom := v_custom || jsonb_build_object(v_key, lower(v_val));
        else
          v_custom := v_custom - v_key;
        end if;
      end if;
    end loop;

    v_branding := v_branding || jsonb_build_object('custom', v_custom);
  end if;

  -- Top-level keys only honored when custom is active (legacy + client resolve).
  if v_preset = 'custom' then
    if v_branding ? 'wordmark' then
      v_branding := v_branding || jsonb_build_object(
        'wordmark', left(trim(v_branding ->> 'wordmark'), 120)
      );
    end if;

    foreach v_key in array v_allowed loop
      if v_branding ? v_key then
        v_val := nullif(trim(v_branding ->> v_key), '');
        if v_val is not null then
          if v_val !~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$' then
            raise exception 'Invalid color for %: %', v_key, v_val;
          end if;
          v_branding := v_branding || jsonb_build_object(v_key, lower(v_val));
        else
          v_branding := v_branding - v_key;
        end if;
      end if;
    end loop;
  else
    v_branding := v_branding - 'wordmark';
    foreach v_key in array v_allowed loop
      v_branding := v_branding - v_key;
    end loop;
  end if;

  return v_branding;
end;
$$;

-- Keep custom logo in branding.custom; sync logo_url column from custom slot (not cleared on preset).
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
  v_logo := nullif(trim(coalesce(p_logo_url, v_branding #>> '{custom,logo_url}')), '');

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
    v_row.id,
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'module_slug', p_module_slug,
      'data_brand', v_branding ->> 'data-brand'
    )
  );

  return jsonb_build_object(
    'module_slug', p_module_slug,
    'branding', v_branding,
    'logo_url', v_logo
  );
end;
$$;
