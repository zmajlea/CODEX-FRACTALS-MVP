-- Fix billing rule resolution + credit_cost null on provision_client_seat

-- Mis-seeded rules used scope=global with module_id set; resolver expects scope=module.
update public.billing_rules
set scope = 'module'
where scope = 'global'
  and module_id is not null;

insert into public.billing_rules (scope, module_id, payer, credit_cost, active)
select 'module', m.id, 'distributor_credits', 1, true
from public.modules m
where m.status in ('active', 'beta')
  and not exists (
    select 1
    from public.billing_rules br
    where br.active = true
      and br.module_id = m.id
      and br.distributor_tenant_id is null
      and br.scope in ('module', 'global')
  );

create or replace function public.resolve_billing_rule_id(
  p_module_id uuid,
  p_distributor_tenant_id uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select br.id
  from public.billing_rules br
  where br.active = true
    and (
      (br.scope = 'grant' and br.module_id = p_module_id and br.distributor_tenant_id = p_distributor_tenant_id)
      or (br.scope = 'module' and br.module_id = p_module_id and br.distributor_tenant_id is null)
      or (br.scope = 'distributor' and br.distributor_tenant_id = p_distributor_tenant_id and br.module_id is null)
      or (br.scope = 'global' and br.module_id is null and br.distributor_tenant_id is null)
      -- legacy rows before scope fix
      or (br.scope = 'global' and br.module_id = p_module_id and br.distributor_tenant_id is null)
    )
  order by
    case br.scope
      when 'grant' then 1
      when 'module' then 2
      when 'global' then 3
      when 'distributor' then 4
      else 5
    end
  limit 1;
$$;

create or replace function public.provision_client_seat(
  p_tenant_id uuid,
  p_client_name text,
  p_client_email text,
  p_module_slug text default 'ff'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tenant public.tenants;
  v_module public.modules;
  v_vault public.vaults;
  v_invite public.vault_invites;
  v_grant public.client_module_access;
  v_token text := public.ff_generate_invite_token();
  v_client_user_id uuid;
  v_billing_rule_id uuid;
  v_credit_cost integer := 1;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_distributor(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  select * into v_module from public.modules where slug = p_module_slug and status in ('active', 'beta');
  if not found then
    raise exception 'Module not found';
  end if;

  if not exists (
    select 1 from public.distributor_modules dm
    where dm.distributor_tenant_id = p_tenant_id
      and dm.module_id = v_module.id
      and dm.allowed = true
  ) and not public.is_global_admin() then
    raise exception 'Distributor may not sell this module';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'Tenant not found';
  end if;

  v_billing_rule_id := public.resolve_billing_rule_id(v_module.id, p_tenant_id);

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

  if nullif(trim(p_client_name), '') is null or nullif(trim(p_client_email), '') is null then
    raise exception 'Client name and email are required';
  end if;

  insert into public.vaults (name, created_by, tenant_id, ff_status)
  values (trim(p_client_name), v_user, p_tenant_id, 'unstarted')
  returning * into v_vault;

  insert into public.vault_invites (
    vault_id, email, role, status, invited_by, invite_token, tenant_id, module_slug
  )
  values (
    v_vault.id, lower(trim(p_client_email)), 'CLIENT', 'pending', v_user, v_token, p_tenant_id, p_module_slug
  )
  returning * into v_invite;

  select u.id into v_client_user_id
  from public.users u where lower(u.email) = lower(trim(p_client_email)) limit 1;

  if v_client_user_id is not null then
    insert into public.user_roles (user_id, role, tenant_id, granted_by)
    values (v_client_user_id, 'client', p_tenant_id, v_user)
    on conflict (user_id, tenant_id) where tenant_id is not null
    do update set role = 'client', granted_by = excluded.granted_by;

    insert into public.client_module_access (
      client_user_id, module_id, distributor_tenant_id, vault_id,
      status, billing_rule_id, granted_by
    )
    values (
      v_client_user_id, v_module.id, p_tenant_id, v_vault.id,
      'active', v_billing_rule_id, v_user
    )
    on conflict (client_user_id, module_id, distributor_tenant_id)
    do update set
      vault_id = excluded.vault_id,
      status = 'active',
      billing_rule_id = excluded.billing_rule_id,
      granted_by = excluded.granted_by,
      granted_at = now()
    returning * into v_grant;
  end if;

  insert into public.credit_transactions (
    tenant_id, amount, action, metadata, delta, reason, ref_grant_id, created_by
  )
  values (
    p_tenant_id,
    -v_credit_cost,
    'seat_provisioned',
    jsonb_build_object(
      'client_email', trim(p_client_email),
      'client_name', trim(p_client_name),
      'module_slug', p_module_slug,
      'vault_id', v_vault.id
    ),
    -v_credit_cost,
    'provision_debit',
    v_grant.id,
    v_user
  );

  insert into public.platform_audit_events (actor_id, actor_tier, action, target_type, target_id, payload)
  values (
    v_user, 'distributor', 'provision_client_seat', 'vault', v_vault.id::text,
    jsonb_build_object('invite_token', v_token, 'module_slug', p_module_slug)
  );

  return jsonb_build_object(
    'vault_id', v_vault.id,
    'invite_id', v_invite.id,
    'invite_token', v_token,
    'grant_id', v_grant.id,
    'module_slug', p_module_slug
  );
end;
$$;
