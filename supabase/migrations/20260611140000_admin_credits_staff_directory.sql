-- Admin: set CPA credits + list distributor staff (invites + active managers)

create or replace function public.set_tenant_credit_balance(
  p_tenant_id uuid,
  p_target_balance integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current bigint;
  v_target bigint := greatest(coalesce(p_target_balance, 0), 0);
  v_delta bigint;
  v_new bigint;
begin
  if not public.is_global_admin() then
    raise exception 'Not authorized: global_admin required';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant not found';
  end if;

  select coalesce(credit_balance, available_credits, 0)
  into v_current
  from public.tenants
  where id = p_tenant_id;

  v_delta := v_target - v_current;

  if v_delta <> 0 then
    insert into public.credit_transactions (
      tenant_id, amount, action, metadata, delta, reason, created_by
    )
    values (
      p_tenant_id,
      v_delta::integer,
      'admin_adjustment',
      jsonb_build_object(
        'previous_balance', v_current,
        'target_balance', v_target,
        'source', 'global_admin_panel'
      ),
      v_delta,
      'global_admin_set',
      auth.uid()
    );

    perform public.sync_tenant_credit_balance(p_tenant_id);

    insert into public.platform_audit_events (actor_id, actor_tier, action, target_type, target_id, payload)
    values (
      auth.uid(), 'global_admin', 'set_tenant_credits', 'tenant', p_tenant_id::text,
      jsonb_build_object('previous', v_current, 'target', v_target, 'delta', v_delta)
    );
  end if;

  select credit_balance into v_new from public.tenants where id = p_tenant_id;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'credit_balance', coalesce(v_new, v_target)
  );
end;
$$;

create or replace function public.list_distributor_staff_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_global_admin() then
    raise exception 'Not authorized: global_admin required';
  end if;

  return coalesce(
    (
      select jsonb_agg(firm order by firm ->> 'tenant_name')
      from (
        select jsonb_build_object(
          'tenant_id', t.id,
          'tenant_name', t.name,
          'domain_slug', t.domain_slug,
          'credit_balance', coalesce(t.credit_balance, t.available_credits, 0),
          'invites', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id', si.id,
                  'email', si.email,
                  'status', si.status,
                  'created_at', si.created_at,
                  'invite_url',
                    case
                      when si.status = 'pending' then '/portal/login?invite=' || si.invite_token
                      else null
                    end
                )
                order by si.created_at desc
              )
              from public.staff_invites si
              where si.tenant_id = t.id
                and si.role = 'distributor'
            ),
            '[]'::jsonb
          ),
          'managers', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'user_id', ur.user_id,
                  'email', u.email,
                  'display_name', u.display_name,
                  'since', ur.created_at
                )
                order by ur.created_at asc
              )
              from public.user_roles ur
              join public.users u on u.id = ur.user_id
              where ur.tenant_id = t.id
                and ur.role = 'distributor'
            ),
            '[]'::jsonb
          )
        ) as firm
        from public.tenants t
        where coalesce(t.is_house, false) = false
      ) firms
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.set_tenant_credit_balance(uuid, integer) to authenticated;
grant execute on function public.list_distributor_staff_directory() to authenticated;
