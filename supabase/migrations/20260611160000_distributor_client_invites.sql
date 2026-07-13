-- Distributor: list client invites, regenerate link, revoke pending invite (+ credit refund)

create or replace function public.list_distributor_client_invites(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_distributor(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  return coalesce(
    (
      select jsonb_agg(row order by (row ->> 'created_at') desc)
      from (
        select jsonb_build_object(
          'invite_id', vi.id,
          'vault_id', v.id,
          'vault_name', v.name,
          'email', vi.email,
          'module_slug', coalesce(vi.module_slug, 'ff'),
          'module_name', coalesce(m.name, 'Financial Firefighter'),
          'status', vi.status,
          'created_at', vi.created_at,
          'invite_token',
            case when vi.status = 'pending' then vi.invite_token else null end
        ) as row
        from public.vault_invites vi
        join public.vaults v on v.id = vi.vault_id
        left join public.modules m on m.slug = coalesce(vi.module_slug, 'ff')
        where vi.tenant_id = p_tenant_id
          and vi.role = 'CLIENT'
      ) invites
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.regenerate_client_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.vault_invites;
  v_module public.modules;
  v_tenant public.tenants;
  v_token text;
  v_billing_rule_id uuid;
  v_credit_cost integer := 1;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite
  from public.vault_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'Invite not found';
  end if;

  if v_invite.tenant_id is null then
    raise exception 'Invite has no tenant';
  end if;

  if not public.is_distributor(v_invite.tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  if v_invite.status = 'accepted' then
    raise exception 'Invite already accepted';
  end if;

  v_token := public.ff_generate_invite_token();

  if v_invite.status = 'pending' then
    update public.vault_invites
    set invite_token = v_token, updated_at = now()
    where id = p_invite_id;

    return jsonb_build_object(
      'invite_id', p_invite_id,
      'invite_token', v_token,
      'status', 'pending',
      'charged_credits', 0
    );
  end if;

  if v_invite.status <> 'revoked' then
    raise exception 'Cannot recreate invite in status %', v_invite.status;
  end if;

  select * into v_module
  from public.modules
  where slug = coalesce(v_invite.module_slug, 'ff')
    and status in ('active', 'beta');

  if not found then
    raise exception 'Module not found';
  end if;

  select * into v_tenant
  from public.tenants
  where id = v_invite.tenant_id
  for update;

  v_billing_rule_id := public.resolve_billing_rule_id(v_module.id, v_invite.tenant_id);

  select coalesce(
    (
      select coalesce(br.credit_cost, 1)
      from public.billing_rules br
      where br.id = v_billing_rule_id
    ),
    1
  )
  into v_credit_cost;

  if coalesce(v_tenant.credit_balance, v_tenant.available_credits) < v_credit_cost then
    raise exception 'Insufficient credits';
  end if;

  update public.vault_invites
  set
    status = 'pending',
    invite_token = v_token,
    updated_at = now()
  where id = p_invite_id;

  update public.client_module_access
  set status = 'active', granted_at = now()
  where vault_id = v_invite.vault_id
    and distributor_tenant_id = v_invite.tenant_id
    and module_id = v_module.id;

  insert into public.credit_transactions (
    tenant_id, amount, action, metadata, delta, reason, created_by
  )
  values (
    v_invite.tenant_id,
    -v_credit_cost,
    'seat_provisioned',
    jsonb_build_object(
      'client_email', v_invite.email,
      'vault_id', v_invite.vault_id,
      'module_slug', coalesce(v_invite.module_slug, 'ff'),
      'invite_id', p_invite_id,
      'source', 'invite_reissue'
    ),
    -v_credit_cost,
    'provision_debit',
    v_user
  );

  insert into public.platform_audit_events (actor_id, actor_tier, action, target_type, target_id, payload)
  values (
    v_user, 'distributor', 'reissue_client_invite', 'vault_invite', p_invite_id::text,
    jsonb_build_object('vault_id', v_invite.vault_id, 'email', v_invite.email)
  );

  return jsonb_build_object(
    'invite_id', p_invite_id,
    'invite_token', v_token,
    'status', 'pending',
    'charged_credits', v_credit_cost
  );
end;
$$;

create or replace function public.revoke_client_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.vault_invites;
  v_refund integer := 1;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite
  from public.vault_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'Invite not found';
  end if;

  if v_invite.tenant_id is null then
    raise exception 'Invite has no tenant';
  end if;

  if not public.is_distributor(v_invite.tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'Only pending invites can be revoked';
  end if;

  select abs(coalesce(ct.delta, ct.amount))::integer
  into v_refund
  from public.credit_transactions ct
  where ct.tenant_id = v_invite.tenant_id
    and ct.action = 'seat_provisioned'
    and ct.metadata ->> 'vault_id' = v_invite.vault_id::text
    and coalesce(ct.delta, ct.amount) < 0
  order by ct.created_at desc
  limit 1;

  v_refund := coalesce(v_refund, 1);

  update public.vault_invites
  set status = 'revoked', updated_at = now()
  where id = p_invite_id;

  update public.client_module_access
  set status = 'revoked'
  where vault_id = v_invite.vault_id
    and distributor_tenant_id = v_invite.tenant_id;

  insert into public.credit_transactions (
    tenant_id, amount, action, metadata, delta, reason, created_by
  )
  values (
    v_invite.tenant_id,
    v_refund,
    'invite_revoked_refund',
    jsonb_build_object(
      'invite_id', p_invite_id,
      'vault_id', v_invite.vault_id,
      'client_email', v_invite.email,
      'refunded', v_refund
    ),
    v_refund,
    'invite_revoked_refund',
    v_user
  );

  insert into public.platform_audit_events (actor_id, actor_tier, action, target_type, target_id, payload)
  values (
    v_user, 'distributor', 'revoke_client_invite', 'vault_invite', p_invite_id::text,
    jsonb_build_object('vault_id', v_invite.vault_id, 'email', v_invite.email, 'refunded', v_refund)
  );

  return jsonb_build_object(
    'invite_id', p_invite_id,
    'status', 'revoked',
    'refunded_credits', v_refund
  );
end;
$$;

grant execute on function public.list_distributor_client_invites(uuid) to authenticated;
grant execute on function public.regenerate_client_invite(uuid) to authenticated;
grant execute on function public.revoke_client_invite(uuid) to authenticated;
