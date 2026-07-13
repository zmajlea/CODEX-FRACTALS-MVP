-- Operator Treasury portfolio RPC + suspend access control

create or replace function public.list_operator_treasury_clients(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_treasury_module_id uuid;
begin
  if not public.is_operator(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  select id into v_treasury_module_id
  from public.modules
  where slug = 'treasury'
  limit 1;

  if v_treasury_module_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(row order by (row ->> 'client_name') asc nulls last)
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
          'status', cma.status,
          'institution_count', (
            select count(*)::int
            from public.plaid_items pi
            where pi.client_user_id = cma.client_user_id
          ),
          'account_count', (
            select count(*)::int
            from public.treasury_accounts ta
            where ta.client_user_id = cma.client_user_id
          ),
          'total_cash', coalesce((
            select sum(ta.current_balance)
            from public.treasury_accounts ta
            where ta.client_user_id = cma.client_user_id
          ), 0),
          'total_cash_by_currency', coalesce((
            select jsonb_object_agg(currency, total)
            from (
              select
                coalesce(ta.iso_currency_code, 'USD') as currency,
                sum(ta.current_balance) as total
              from public.treasury_accounts ta
              where ta.client_user_id = cma.client_user_id
              group by coalesce(ta.iso_currency_code, 'USD')
            ) sums
          ), '{}'::jsonb),
          'last_synced_at', (
            select max(ta.updated_at)
            from public.treasury_accounts ta
            where ta.client_user_id = cma.client_user_id
          )
        ) as row
        from public.client_module_access cma
        join auth.users u on u.id = cma.client_user_id
        where cma.distributor_tenant_id = p_tenant_id
          and cma.module_id = v_treasury_module_id
          and cma.status = 'active'
      ) clients
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.suspend_operator_client_access(p_grant_id uuid)
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
    raise exception 'Grant is revoked';
  end if;

  if v_grant.status = 'suspended' then
    return jsonb_build_object('grant_id', p_grant_id, 'status', 'suspended');
  end if;

  update public.client_module_access
  set status = 'suspended'
  where id = p_grant_id;

  return jsonb_build_object('grant_id', p_grant_id, 'status', 'suspended');
end;
$$;

grant execute on function public.list_operator_treasury_clients(uuid) to authenticated;
grant execute on function public.suspend_operator_client_access(uuid) to authenticated;
