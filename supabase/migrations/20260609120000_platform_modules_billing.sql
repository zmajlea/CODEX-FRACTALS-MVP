-- Platform Step 1: modules catalog, grants, billing rules, tenant extensions, audit

-- ---------------------------------------------------------------------------
-- Extend tenants (distributors)
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists kind text not null default 'distributor',
  add column if not exists is_house boolean not null default false,
  add column if not exists branding jsonb not null default '{}'::jsonb,
  add column if not exists credit_balance bigint not null default 0;

alter table public.tenants
  drop constraint if exists tenants_kind_check;

alter table public.tenants
  add constraint tenants_kind_check check (kind in ('distributor'));

update public.tenants
set
  credit_balance = available_credits,
  branding = coalesce(branding, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    '--cinnabar', brand_color_hex,
    'logoUrl', logo_url,
    'data-brand', 'ff3'
  ))
where branding = '{}'::jsonb or credit_balance = 0;

-- ---------------------------------------------------------------------------
-- Extend user_roles
-- ---------------------------------------------------------------------------
alter table public.user_roles
  add column if not exists granted_by uuid references public.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Extend credit_transactions ledger
-- ---------------------------------------------------------------------------
alter table public.credit_transactions
  add column if not exists delta bigint,
  add column if not exists reason text,
  add column if not exists ref_grant_id uuid,
  add column if not exists created_by uuid references public.users (id) on delete set null;

update public.credit_transactions
set
  delta = amount,
  reason = case
    when action = 'seat_provisioned' then 'provision_debit'
    when action = 'purchase' then 'admin_allocation'
    when action = 'invite_sent' then 'invite_sent'
    else action
  end
where delta is null;

-- ---------------------------------------------------------------------------
-- Modules catalog
-- ---------------------------------------------------------------------------
create table if not exists public.modules (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'beta', 'retired')),
  default_billing_mode text not null default 'distributor_credits'
    check (default_billing_mode in ('distributor_credits', 'client_stripe')),
  route_base text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger modules_set_updated_at
before update on public.modules
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Billing rules
-- ---------------------------------------------------------------------------
create table if not exists public.billing_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'distributor', 'module', 'grant')),
  module_id uuid references public.modules (id) on delete cascade,
  distributor_tenant_id uuid references public.tenants (id) on delete cascade,
  payer text not null check (payer in ('distributor_credits', 'client_stripe')),
  unit_price_cents integer,
  currency text not null default 'usd',
  credit_cost integer not null default 1,
  stripe_price_id text,
  active boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Distributor may sell module (Global Admin sets)
-- ---------------------------------------------------------------------------
create table if not exists public.distributor_modules (
  distributor_tenant_id uuid not null references public.tenants (id) on delete cascade,
  module_id uuid not null references public.modules (id) on delete cascade,
  allowed boolean not null default true,
  granted_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (distributor_tenant_id, module_id)
);

-- ---------------------------------------------------------------------------
-- Client module grants (M2M — visibility + branding source)
-- ---------------------------------------------------------------------------
create table if not exists public.client_module_access (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references public.users (id) on delete cascade,
  module_id uuid not null references public.modules (id) on delete cascade,
  distributor_tenant_id uuid not null references public.tenants (id) on delete cascade,
  vault_id uuid references public.vaults (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  billing_rule_id uuid references public.billing_rules (id) on delete set null,
  granted_by uuid references public.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (client_user_id, module_id, distributor_tenant_id)
);

create index client_module_access_client_idx
  on public.client_module_access (client_user_id, status);

create index client_module_access_distributor_idx
  on public.client_module_access (distributor_tenant_id);

alter table public.credit_transactions
  drop constraint if exists credit_transactions_ref_grant_id_fkey;

alter table public.credit_transactions
  add constraint credit_transactions_ref_grant_id_fkey
  foreign key (ref_grant_id) references public.client_module_access (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Stripe mirrors (Step 4 cache)
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.stripe_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  module_id uuid not null references public.modules (id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  status text not null default 'inactive',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger stripe_subscriptions_set_updated_at
before update on public.stripe_subscriptions
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Platform audit (privileged mutations)
-- ---------------------------------------------------------------------------
create table if not exists public.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users (id) on delete set null,
  actor_tier text,
  action text not null,
  target_type text,
  target_id text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index platform_audit_events_created_idx
  on public.platform_audit_events (created_at desc);

-- ---------------------------------------------------------------------------
-- Credit balance sync helper
-- ---------------------------------------------------------------------------
create or replace function public.sync_tenant_credit_balance(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  select coalesce(sum(coalesce(delta, amount)), 0)
  into v_balance
  from public.credit_transactions
  where tenant_id = p_tenant_id;

  update public.tenants
  set
    credit_balance = greatest(v_balance, 0),
    available_credits = greatest(v_balance, 0)::integer
  where id = p_tenant_id;
end;
$$;

create or replace function public.trg_sync_credit_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_tenant_credit_balance(coalesce(new.tenant_id, old.tenant_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists credit_transactions_sync_balance on public.credit_transactions;
create trigger credit_transactions_sync_balance
after insert or update or delete on public.credit_transactions
for each row execute function public.trg_sync_credit_balance();

-- ---------------------------------------------------------------------------
-- Resolve default billing rule for module + distributor
-- ---------------------------------------------------------------------------
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
    )
  order by
    case br.scope
      when 'grant' then 1
      when 'module' then 2
      when 'distributor' then 3
      when 'global' then 4
      else 5
    end
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Platform login route (prefers client_module_access)
-- ---------------------------------------------------------------------------
create or replace function public.get_ff_login_route()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_grant record;
  v_dist record;
begin
  if v_user is null then
    return jsonb_build_object('route', '/login');
  end if;

  if public.is_global_admin() then
    return jsonb_build_object('route', '/admin', 'role', 'global_admin');
  end if;

  select ur.tenant_id, t.domain_slug
  into v_dist
  from public.user_roles ur
  join public.tenants t on t.id = ur.tenant_id
  where ur.user_id = v_user and ur.role = 'distributor'
  order by ur.created_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'route', '/distributor',
      'role', 'distributor',
      'tenant_id', v_dist.tenant_id,
      'domain_slug', v_dist.domain_slug
    );
  end if;

  select
    cma.id as grant_id,
    m.slug as module_slug,
    m.route_base,
    t.domain_slug,
    cma.distributor_tenant_id
  into v_grant
  from public.client_module_access cma
  join public.modules m on m.id = cma.module_id
  join public.tenants t on t.id = cma.distributor_tenant_id
  where cma.client_user_id = v_user
    and cma.status = 'active'
  order by cma.granted_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'route', '/client' || v_grant.route_base,
      'role', 'client',
      'grant_id', v_grant.grant_id,
      'module_slug', v_grant.module_slug,
      'domain_slug', v_grant.domain_slug,
      'tenant_id', v_grant.distributor_tenant_id
    );
  end if;

  return jsonb_build_object('route', '/login', 'role', 'none');
end;
$$;

-- ---------------------------------------------------------------------------
-- Provision client seat (grant + vault + invite)
-- ---------------------------------------------------------------------------
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
    vault_id, email, role, status, invited_by, invite_token, tenant_id
  )
  values (
    v_vault.id, lower(trim(p_client_email)), 'CLIENT', 'pending', v_user, v_token, p_tenant_id
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
    'grant_id', v_grant.id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- @codexone.io global admin elevation (server-side)
-- ---------------------------------------------------------------------------
create or replace function public.elevate_codexone_global_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
begin
  if v_user is null then
    return false;
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email !~ '@codexone\.io$' then
    return false;
  end if;

  insert into public.user_roles (user_id, role, tenant_id)
  values (v_user, 'global_admin', null)
  on conflict (user_id) where role = 'global_admin'
  do nothing;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.modules enable row level security;
alter table public.billing_rules enable row level security;
alter table public.distributor_modules enable row level security;
alter table public.client_module_access enable row level security;
alter table public.stripe_customers enable row level security;
alter table public.stripe_subscriptions enable row level security;
alter table public.platform_audit_events enable row level security;

create policy modules_select_authenticated
on public.modules for select to authenticated using (true);

create policy modules_write_global_admin
on public.modules for all
using (public.is_global_admin())
with check (public.is_global_admin());

create policy billing_rules_select_global_admin
on public.billing_rules for select
using (public.is_global_admin());

create policy billing_rules_select_distributor
on public.billing_rules for select
using (
  distributor_tenant_id is not null
  and public.is_distributor(distributor_tenant_id)
);

create policy billing_rules_write_global_admin
on public.billing_rules for all
using (public.is_global_admin())
with check (public.is_global_admin());

create policy distributor_modules_select
on public.distributor_modules for select
using (
  public.is_global_admin()
  or public.is_distributor(distributor_tenant_id)
);

create policy distributor_modules_write_global_admin
on public.distributor_modules for all
using (public.is_global_admin())
with check (public.is_global_admin());

create policy client_module_access_select_own
on public.client_module_access for select
using (
  client_user_id = auth.uid()
  or public.is_global_admin()
  or public.is_distributor(distributor_tenant_id)
);

create policy client_module_access_insert_distributor
on public.client_module_access for insert
with check (
  public.is_distributor(distributor_tenant_id)
  or public.is_global_admin()
);

create policy client_module_access_update_distributor
on public.client_module_access for update
using (public.is_distributor(distributor_tenant_id) or public.is_global_admin())
with check (public.is_distributor(distributor_tenant_id) or public.is_global_admin());

create policy stripe_customers_select_own
on public.stripe_customers for select
using (user_id = auth.uid() or public.is_global_admin());

create policy stripe_subscriptions_select_own
on public.stripe_subscriptions for select
using (user_id = auth.uid() or public.is_global_admin());

create policy platform_audit_select_global_admin
on public.platform_audit_events for select
using (public.is_global_admin());

create policy platform_audit_insert_service
on public.platform_audit_events for insert
with check (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------
insert into public.modules (slug, name, status, default_billing_mode, route_base)
values
  ('ff', 'Financial Firefighter', 'active', 'distributor_credits', '/ff'),
  ('deadlines', 'Deadlines', 'beta', 'distributor_credits', '/deadlines')
on conflict (slug) do update
set name = excluded.name, route_base = excluded.route_base;

insert into public.tenants (
  name, domain_slug, brand_color_hex, available_credits, credit_balance,
  is_house, branding
)
values (
  'CodexOne',
  'codexone',
  '#E67E50',
  100,
  100,
  true,
  jsonb_build_object(
    '--cinnabar', '#E67E50',
    '--vellum', '#FCFBF9',
    'data-brand', 'fractals',
    'wordmark', 'CodexOne'
  )
)
on conflict (domain_slug) do update
set
  is_house = true,
  credit_balance = greatest(public.tenants.credit_balance, 100),
  available_credits = greatest(public.tenants.available_credits, 100);

insert into public.billing_rules (
  scope, module_id, payer, credit_cost, active
)
select 'global', m.id, 'distributor_credits', 1, true
from public.modules m
where m.slug = 'ff'
  and not exists (
    select 1 from public.billing_rules br
    where br.scope = 'global' and br.module_id = m.id
  );

insert into public.distributor_modules (distributor_tenant_id, module_id, allowed)
select t.id, m.id, true
from public.tenants t
cross join public.modules m
where t.domain_slug in ('demo', 'codexone')
on conflict do nothing;

-- sync all tenant balances from ledger
do $$
declare r record;
begin
  for r in select id from public.tenants loop
    perform public.sync_tenant_credit_balance(r.id);
  end loop;
end $$;
