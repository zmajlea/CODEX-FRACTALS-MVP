-- Phase F: operator client controls (list, revoke access, erase record)

create or replace function public.list_operator_clients(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_operator(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  return coalesce(
    (
      select jsonb_agg(row order by (row ->> 'granted_at') desc nulls last)
      from (
        select jsonb_build_object(
          'grant_id', cma.id,
          'client_user_id', cma.client_user_id,
          'client_email', u.email,
          'client_name', coalesce(
            nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
            nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
            split_part(u.email, '@', 1)
          ),
          'module_slug', m.slug,
          'module_name', m.name,
          'vault_id', v.id,
          'vault_name', v.name,
          'grant_status', cma.status,
          'ff_status', v.ff_status,
          'granted_at', cma.granted_at,
          'sealed_sections', (
            select count(*)::int
            from public.ff_continuity_sections fcs
            where fcs.vault_id = v.id and fcs.sealed_at is not null
          )
        ) as row
        from public.client_module_access cma
        join auth.users u on u.id = cma.client_user_id
        join public.modules m on m.id = cma.module_id
        left join public.vaults v on v.id = cma.vault_id
        where cma.distributor_tenant_id = p_tenant_id
          and cma.status in ('active', 'suspended', 'revoked')
      ) clients
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.revoke_operator_client_access(p_grant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.client_module_access;
begin
  select * into v_grant
  from public.client_module_access
  where id = p_grant_id
  for update;

  if not found then
    raise exception 'Grant not found';
  end if;

  if not public.is_operator(v_grant.distributor_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this client';
  end if;

  if v_grant.status = 'revoked' then
    return jsonb_build_object('grant_id', p_grant_id, 'status', 'revoked');
  end if;

  update public.client_module_access
  set status = 'revoked'
  where id = p_grant_id;

  update public.vault_invites
  set status = 'revoked', updated_at = now()
  where vault_id = v_grant.vault_id
    and status in ('pending', 'accepted');

  return jsonb_build_object('grant_id', p_grant_id, 'status', 'revoked');
end;
$$;

create or replace function public.erase_operator_client_record(p_grant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.client_module_access;
  v_vault_id uuid;
begin
  select * into v_grant
  from public.client_module_access
  where id = p_grant_id
  for update;

  if not found then
    raise exception 'Grant not found';
  end if;

  if not public.is_operator(v_grant.distributor_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this client';
  end if;

  v_vault_id := v_grant.vault_id;

  if v_vault_id is not null then
    delete from public.vaults where id = v_vault_id;
  end if;

  update public.client_module_access
  set status = 'revoked', vault_id = null
  where id = p_grant_id;

  return jsonb_build_object(
    'grant_id', p_grant_id,
    'vault_deleted', v_vault_id is not null,
    'status', 'revoked'
  );
end;
$$;

grant execute on function public.list_operator_clients(uuid) to authenticated;
grant execute on function public.revoke_operator_client_access(uuid) to authenticated;
grant execute on function public.erase_operator_client_record(uuid) to authenticated;
