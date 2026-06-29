-- FF V1 Phase 1: 3-tier commercial RBAC (global_admin → distributor → client)
-- Extends 20260607120000_ff_v1_tenants_billing.sql

-- ---------------------------------------------------------------------------
-- Rename subdomain → domain_slug (spec alignment)
-- ---------------------------------------------------------------------------
alter table public.tenants
  rename column subdomain to domain_slug;

-- ---------------------------------------------------------------------------
-- Commercial role enum + user_roles mapping table
-- ---------------------------------------------------------------------------
create type public.ff_commercial_role as enum (
  'global_admin',
  'distributor',
  'client'
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  role public.ff_commercial_role not null,
  tenant_id uuid references public.tenants (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_roles_tenant_required check (
    role = 'global_admin' or tenant_id is not null
  )
);

create unique index user_roles_global_admin_unique
  on public.user_roles (user_id)
  where role = 'global_admin';

create unique index user_roles_user_tenant_unique
  on public.user_roles (user_id, tenant_id)
  where tenant_id is not null;

create index user_roles_user_id_idx on public.user_roles (user_id);
create index user_roles_tenant_id_idx on public.user_roles (tenant_id);

-- Migrate legacy tenant_members (ADMIN) → distributor
insert into public.user_roles (user_id, role, tenant_id)
select tm.user_id, 'distributor'::public.ff_commercial_role, tm.tenant_id
from public.tenant_members tm
where tm.role = 'ADMIN'
on conflict (user_id, tenant_id) where tenant_id is not null do nothing;

-- ---------------------------------------------------------------------------
-- RBAC helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_global_admin()
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
      and ur.role = 'global_admin'
  );
$$;

create or replace function public.is_distributor(p_tenant_id uuid)
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
      and ur.role = 'distributor'
      and ur.tenant_id = p_tenant_id
  );
$$;

create or replace function public.is_ff_client(p_tenant_id uuid)
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
      and ur.role = 'client'
      and ur.tenant_id = p_tenant_id
  );
$$;

-- Backward-compatible alias used by provision_client_seat and existing policies
create or replace function public.is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_distributor(p_tenant_id);
$$;

-- Primary role for post-login routing (Phase 2)
create or replace function public.get_ff_login_route()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_global boolean;
  v_dist record;
  v_client record;
begin
  if v_user is null then
    return jsonb_build_object('route', '/login');
  end if;

  v_global := public.is_global_admin();
  if v_global then
    return jsonb_build_object('route', '/admin', 'role', 'global_admin');
  end if;

  select ur.tenant_id, t.domain_slug
  into v_dist
  from public.user_roles ur
  join public.tenants t on t.id = ur.tenant_id
  where ur.user_id = v_user
    and ur.role = 'distributor'
  order by ur.created_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'route', '/' || v_dist.domain_slug || '/admin',
      'role', 'distributor',
      'tenant_id', v_dist.tenant_id,
      'domain_slug', v_dist.domain_slug
    );
  end if;

  select ur.tenant_id, t.domain_slug
  into v_client
  from public.user_roles ur
  join public.tenants t on t.id = ur.tenant_id
  where ur.user_id = v_user
    and ur.role = 'client'
  order by ur.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'route', '/' || v_client.domain_slug || '/wizard',
      'role', 'client',
      'tenant_id', v_client.tenant_id,
      'domain_slug', v_client.domain_slug
    );
  end if;

  return jsonb_build_object('route', '/switchboard', 'role', 'none');
end;
$$;

-- ---------------------------------------------------------------------------
-- Global Admin: create distributor tenant
-- ---------------------------------------------------------------------------
create or replace function public.create_distributor_tenant(
  p_name text,
  p_domain_slug text,
  p_brand_color_hex text default '#E67E50',
  p_logo_url text default null,
  p_initial_credits integer default 0
)
returns public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants;
  v_slug text := lower(trim(p_domain_slug));
begin
  if not public.is_global_admin() then
    raise exception 'Not authorized: global_admin required';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Tenant name is required';
  end if;

  if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'Invalid domain_slug';
  end if;

  insert into public.tenants (
    name,
    domain_slug,
    brand_color_hex,
    logo_url,
    available_credits
  )
  values (
    trim(p_name),
    v_slug,
    coalesce(nullif(trim(p_brand_color_hex), ''), '#E67E50'),
    nullif(trim(p_logo_url), ''),
    greatest(coalesce(p_initial_credits, 0), 0)
  )
  returning * into v_tenant;

  if coalesce(p_initial_credits, 0) > 0 then
    insert into public.credit_transactions (tenant_id, amount, action, metadata)
    values (
      v_tenant.id,
      p_initial_credits,
      'purchase',
      jsonb_build_object('source', 'global_admin_create')
    );
  end if;

  return v_tenant;
end;
$$;

-- Assign distributor role to a user for a tenant
create or replace function public.assign_distributor(
  p_tenant_id uuid,
  p_user_id uuid
)
returns public.user_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_roles;
begin
  if not public.is_global_admin() then
    raise exception 'Not authorized: global_admin required';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant not found';
  end if;

  insert into public.user_roles (user_id, role, tenant_id)
  values (p_user_id, 'distributor', p_tenant_id)
  on conflict (user_id, tenant_id) where tenant_id is not null
  do update set role = 'distributor'
  returning * into v_row;

  return v_row;
end;
$$;

-- Dev bootstrap: first user becomes global_admin when none exist
create or replace function public.claim_bootstrap_global_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from public.user_roles where role = 'global_admin') then
    return public.is_global_admin();
  end if;

  insert into public.user_roles (user_id, role, tenant_id)
  values (v_user, 'global_admin', null);

  return true;
end;
$$;

-- Update provision_client_seat: assign client role on invite
create or replace function public.provision_client_seat(
  p_tenant_id uuid,
  p_client_name text,
  p_client_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tenant public.tenants;
  v_vault public.vaults;
  v_invite public.vault_invites;
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_client_user_id uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_distributor(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'Tenant not found';
  end if;

  if v_tenant.available_credits < 1 then
    raise exception 'Insufficient credits';
  end if;

  if nullif(trim(p_client_name), '') is null then
    raise exception 'Client name is required';
  end if;

  if nullif(trim(p_client_email), '') is null then
    raise exception 'Client email is required';
  end if;

  update public.tenants
  set available_credits = available_credits - 1
  where id = p_tenant_id;

  insert into public.credit_transactions (tenant_id, amount, action, metadata)
  values (
    p_tenant_id,
    -1,
    'seat_provisioned',
    jsonb_build_object('client_email', trim(p_client_email), 'client_name', trim(p_client_name))
  );

  insert into public.vaults (name, created_by, tenant_id, ff_status)
  values (trim(p_client_name), v_user, p_tenant_id, 'unstarted')
  returning * into v_vault;

  insert into public.vault_invites (
    vault_id,
    email,
    role,
    status,
    invited_by,
    invite_token,
    tenant_id
  )
  values (
    v_vault.id,
    lower(trim(p_client_email)),
    'CLIENT',
    'pending',
    v_user,
    v_token,
    p_tenant_id
  )
  returning * into v_invite;

  select u.id into v_client_user_id
  from public.users u
  where lower(u.email) = lower(trim(p_client_email))
  limit 1;

  if v_client_user_id is not null then
    insert into public.user_roles (user_id, role, tenant_id)
    values (v_client_user_id, 'client', p_tenant_id)
    on conflict (user_id, tenant_id) where tenant_id is not null
    do update set role = 'client';
  end if;

  insert into public.credit_transactions (tenant_id, amount, action, metadata)
  values (
    p_tenant_id,
    0,
    'invite_sent',
    jsonb_build_object(
      'vault_id', v_vault.id,
      'invite_id', v_invite.id,
      'invite_token', v_token
    )
  );

  return jsonb_build_object(
    'vault_id', v_vault.id,
    'invite_id', v_invite.id,
    'invite_token', v_token
  );
end;
$$;

-- Update demo distributor claim
create or replace function public.claim_demo_tenant_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tenant_id uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_tenant_id from public.tenants where domain_slug = 'demo' limit 1;
  if v_tenant_id is null then
    return false;
  end if;

  if exists (
    select 1 from public.user_roles
    where tenant_id = v_tenant_id and role = 'distributor'
  ) then
    return public.is_distributor(v_tenant_id);
  end if;

  insert into public.user_roles (user_id, role, tenant_id)
  values (v_user, 'distributor', v_tenant_id);

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: user_roles + global admin tenant management
-- ---------------------------------------------------------------------------
alter table public.user_roles enable row level security;

create policy user_roles_select_own
on public.user_roles for select
using (user_id = auth.uid() or public.is_global_admin());

create policy user_roles_insert_global_admin
on public.user_roles for insert
with check (public.is_global_admin());

create policy user_roles_update_global_admin
on public.user_roles for update
using (public.is_global_admin())
with check (public.is_global_admin());

create policy user_roles_delete_global_admin
on public.user_roles for delete
using (public.is_global_admin());

create policy tenants_insert_global_admin
on public.tenants for insert
with check (public.is_global_admin());

create policy tenants_update_global_admin
on public.tenants for update
using (public.is_global_admin())
with check (public.is_global_admin());

create policy tenants_update_distributor_credits
on public.tenants for update
using (public.is_distributor(id))
with check (public.is_distributor(id));

-- Distributors may read credit ledger for their tenant
create policy credit_transactions_select_distributor
on public.credit_transactions for select
using (public.is_distributor(tenant_id));

-- Allow users to read their own client/distributor role rows (covered by select_own)

-- Client role self-insert when accepting vault invite (email match)
create policy user_roles_insert_client_self
on public.user_roles for insert
with check (
  user_id = auth.uid()
  and role = 'client'
  and tenant_id is not null
  and exists (
    select 1
    from public.vault_invites vi
    where vi.tenant_id = user_roles.tenant_id
      and vi.status in ('pending', 'accepted')
      and lower(vi.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);
