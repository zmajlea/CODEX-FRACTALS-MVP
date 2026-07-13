-- Split login: staff invites (portal) + client invite acceptance RPC

alter table public.vault_invites
  add column if not exists module_slug text default 'ff';

-- ---------------------------------------------------------------------------
-- Staff invites (global_admin + distributor) — invitation-only portal access
-- ---------------------------------------------------------------------------
create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role public.ff_commercial_role not null,
  tenant_id uuid references public.tenants (id) on delete cascade,
  invite_token text not null unique default public.ff_generate_invite_token(),
  status public.invite_status not null default 'pending',
  invited_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint staff_invites_role_tenant check (
    (role = 'distributor' and tenant_id is not null)
    or (role = 'global_admin' and tenant_id is null)
  )
);

create index if not exists staff_invites_email_idx on public.staff_invites (lower(email));
create index if not exists staff_invites_token_idx on public.staff_invites (invite_token);

alter table public.staff_invites enable row level security;

create policy staff_invites_select_global_admin
on public.staff_invites for select
using (public.is_global_admin());

create policy staff_invites_select_own_email
on public.staff_invites for select
using (
  lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

-- ---------------------------------------------------------------------------
-- Invite preview (login pages — token only, no PII beyond email + firm)
-- ---------------------------------------------------------------------------
create or replace function public.get_staff_invite_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.staff_invites;
  v_tenant_name text;
begin
  select * into v_row
  from public.staff_invites
  where invite_token = p_token and status = 'pending';

  if not found then
    return jsonb_build_object('valid', false);
  end if;

  if v_row.tenant_id is not null then
    select name into v_tenant_name from public.tenants where id = v_row.tenant_id;
  end if;

  return jsonb_build_object(
    'valid', true,
    'email', v_row.email,
    'role', v_row.role,
    'tenant_name', v_tenant_name
  );
end;
$$;

create or replace function public.get_client_invite_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_invite public.vault_invites;
  v_tenant_name text;
  v_module_name text;
begin
  select * into v_invite
  from public.vault_invites
  where invite_token = p_token and status = 'pending';

  if not found then
    return jsonb_build_object('valid', false);
  end if;

  if v_invite.tenant_id is not null then
    select name into v_tenant_name from public.tenants where id = v_invite.tenant_id;
  end if;

  select m.name into v_module_name
  from public.modules m
  where m.slug = coalesce(v_invite.module_slug, 'ff');

  return jsonb_build_object(
    'valid', true,
    'email', v_invite.email,
    'tenant_name', v_tenant_name,
    'module_slug', coalesce(v_invite.module_slug, 'ff'),
    'module_name', coalesce(v_module_name, 'Financial Firefighter')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff invite RPCs (global admin only)
-- ---------------------------------------------------------------------------
create or replace function public.invite_distributor_staff(
  p_tenant_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.staff_invites;
begin
  if not public.is_global_admin() then
    raise exception 'Not authorized: global_admin required';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant not found';
  end if;

  if nullif(trim(p_email), '') is null then
    raise exception 'Email is required';
  end if;

  insert into public.staff_invites (email, role, tenant_id, invited_by)
  values (lower(trim(p_email)), 'distributor', p_tenant_id, auth.uid())
  returning * into v_row;

  insert into public.platform_audit_events (actor_id, actor_tier, action, target_type, target_id, payload)
  values (
    auth.uid(), 'global_admin', 'invite_distributor_staff', 'staff_invite', v_row.id::text,
    jsonb_build_object('email', v_row.email, 'tenant_id', p_tenant_id)
  );

  return jsonb_build_object('invite_id', v_row.id, 'invite_token', v_row.invite_token);
end;
$$;

create or replace function public.invite_global_admin_staff(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.staff_invites;
begin
  if not public.is_global_admin() then
    raise exception 'Not authorized: global_admin required';
  end if;

  if nullif(trim(p_email), '') is null then
    raise exception 'Email is required';
  end if;

  insert into public.staff_invites (email, role, tenant_id, invited_by)
  values (lower(trim(p_email)), 'global_admin', null, auth.uid())
  returning * into v_row;

  return jsonb_build_object('invite_id', v_row.id, 'invite_token', v_row.invite_token);
end;
$$;

create or replace function public.accept_staff_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invite public.staff_invites;
  v_email text;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_email from public.users where id = v_user;
  if v_email is null then
    v_email := auth.jwt() ->> 'email';
  end if;

  select * into v_invite
  from public.staff_invites
  where invite_token = p_token and status = 'pending'
  for update;

  if not found then
    raise exception 'Invite not found or already used';
  end if;

  if lower(v_invite.email) <> lower(coalesce(v_email, '')) then
    raise exception 'Sign in with the invited email address';
  end if;

  if v_invite.role = 'global_admin' then
    insert into public.user_roles (user_id, role, tenant_id, granted_by)
    values (v_user, 'global_admin', null, v_invite.invited_by)
    on conflict (user_id, tenant_id) where tenant_id is null
    do update set role = 'global_admin';
  elsif v_invite.role = 'distributor' then
    insert into public.user_roles (user_id, role, tenant_id, granted_by)
    values (v_user, 'distributor', v_invite.tenant_id, v_invite.invited_by)
    on conflict (user_id, tenant_id) where tenant_id is not null
    do update set role = 'distributor', granted_by = excluded.granted_by;
  end if;

  update public.staff_invites set status = 'accepted' where id = v_invite.id;

  if v_invite.role = 'global_admin' then
    return jsonb_build_object('route', '/admin', 'role', 'global_admin');
  end if;

  return jsonb_build_object(
    'route', '/distributor',
    'role', 'distributor',
    'tenant_id', v_invite.tenant_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Client invite acceptance (creates grant when user signs up after provision)
-- ---------------------------------------------------------------------------
create or replace function public.accept_client_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_invite public.vault_invites;
  v_vault public.vaults;
  v_module public.modules;
  v_grant public.client_module_access;
  v_billing_rule_id uuid;
  v_slug text;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_email from public.users where id = v_user;
  if v_email is null then
    v_email := auth.jwt() ->> 'email';
  end if;

  select * into v_invite
  from public.vault_invites
  where invite_token = p_token and status in ('pending', 'accepted')
  for update;

  if not found then
    raise exception 'Invite not found';
  end if;

  if lower(v_invite.email) <> lower(coalesce(v_email, '')) then
    raise exception 'Sign in with the invited email address';
  end if;

  select * into v_vault from public.vaults where id = v_invite.vault_id;
  if not found then
    raise exception 'Vault not found';
  end if;

  v_slug := coalesce(nullif(trim(v_invite.module_slug), ''), 'ff');
  select * into v_module from public.modules where slug = v_slug and status in ('active', 'beta');
  if not found then
    raise exception 'Module not found';
  end if;

  insert into public.vault_members (vault_id, user_id, role)
  values (v_vault.id, v_user, 'CLIENT')
  on conflict (vault_id, user_id) do update set role = 'CLIENT';

  if v_vault.tenant_id is not null then
    insert into public.user_roles (user_id, role, tenant_id, granted_by)
    values (v_user, 'client', v_vault.tenant_id, v_invite.invited_by)
    on conflict (user_id, tenant_id) where tenant_id is not null
    do update set role = 'client';
  end if;

  v_billing_rule_id := public.resolve_billing_rule_id(v_module.id, v_vault.tenant_id);

  insert into public.client_module_access (
    client_user_id, module_id, distributor_tenant_id, vault_id,
    status, billing_rule_id, granted_by
  )
  values (
    v_user, v_module.id, v_vault.tenant_id, v_vault.id,
    'active', v_billing_rule_id, v_invite.invited_by
  )
  on conflict (client_user_id, module_id, distributor_tenant_id)
  do update set
    vault_id = excluded.vault_id,
    status = 'active',
    billing_rule_id = excluded.billing_rule_id,
    granted_at = now()
  returning * into v_grant;

  if v_invite.status = 'pending' then
    update public.vault_invites set status = 'accepted' where id = v_invite.id;
  end if;

  return jsonb_build_object(
    'route', '/client' || v_module.route_base,
    'role', 'client',
    'grant_id', v_grant.id,
    'module_slug', v_module.slug
  );
end;
$$;

-- Store module_slug on client invites
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

  select coalesce(br.credit_cost, 1) into v_credit_cost
  from public.billing_rules br
  where br.id = v_billing_rule_id;

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

grant execute on function public.get_staff_invite_preview(text) to anon, authenticated;
grant execute on function public.get_client_invite_preview(text) to anon, authenticated;
grant execute on function public.invite_distributor_staff(uuid, text) to authenticated;
grant execute on function public.invite_global_admin_staff(text) to authenticated;
grant execute on function public.accept_staff_invite(text) to authenticated;
grant execute on function public.accept_client_invite(text) to authenticated;
