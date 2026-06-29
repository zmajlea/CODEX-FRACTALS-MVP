-- Financial Firefighter V1: tenants, billing, continuity, trusted advisors

create type public.ff_status as enum ('unstarted', 'in_progress', 'sealed');

-- ---------------------------------------------------------------------------
-- Tenants (white-label CPA firms)
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subdomain text not null unique,
  logo_url text,
  brand_color_hex text default '#E67E50',
  available_credits integer not null default 0 check (available_credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tenants_set_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null default 'ADMIN',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index tenant_members_user_id_idx on public.tenant_members (user_id);

-- ---------------------------------------------------------------------------
-- Billing ledger
-- ---------------------------------------------------------------------------
create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  amount integer not null,
  action text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index credit_transactions_tenant_idx
  on public.credit_transactions (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Vault extensions for FF
-- ---------------------------------------------------------------------------
alter table public.vaults
  add column if not exists tenant_id uuid references public.tenants (id),
  add column if not exists ff_status public.ff_status not null default 'unstarted';

create index vaults_tenant_id_idx on public.vaults (tenant_id);

-- ---------------------------------------------------------------------------
-- Continuity sections (E2E ciphertext per section)
-- ---------------------------------------------------------------------------
create table public.ff_continuity_sections (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  section_id text not null,
  payload_ciphertext text,
  sealed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (vault_id, section_id)
);

create trigger ff_continuity_sections_set_updated_at
before update on public.ff_continuity_sections
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Trusted advisors (plaintext — server-readable for transactional email)
-- ---------------------------------------------------------------------------
create table public.ff_trusted_advisors (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  name text not null,
  email text not null,
  role text not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index ff_trusted_advisors_vault_idx
  on public.ff_trusted_advisors (vault_id);

-- ---------------------------------------------------------------------------
-- Vault invite tokens for wizard deep links
-- ---------------------------------------------------------------------------
alter table public.vault_invites
  add column if not exists invite_token text unique default encode(gen_random_bytes(32), 'hex'),
  add column if not exists tenant_id uuid references public.tenants (id);

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.role = 'ADMIN'
  );
$$;

-- ---------------------------------------------------------------------------
-- Provision client seat (atomic credit spend + vault + invite)
-- ---------------------------------------------------------------------------
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
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_tenant_admin(p_tenant_id) then
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

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.ff_continuity_sections enable row level security;
alter table public.ff_trusted_advisors enable row level security;

-- Public branding fields (name, logo, accent) for white-label layout
create policy tenants_select_branding
on public.tenants for select
using (true);

create policy tenant_members_select_own
on public.tenant_members for select
using (user_id = auth.uid());

create policy credit_transactions_select_tenant_admin
on public.credit_transactions for select
using (public.is_tenant_admin(tenant_id));

create policy vaults_select_tenant_admin
on public.vaults for select
using (
  tenant_id is not null
  and public.is_tenant_admin(tenant_id)
);

create policy ff_continuity_sections_member
on public.ff_continuity_sections for all
using (public.is_vault_member(vault_id))
with check (public.is_vault_member(vault_id));

create policy ff_trusted_advisors_member
on public.ff_trusted_advisors for all
using (public.is_vault_member(vault_id))
with check (public.is_vault_member(vault_id));

create policy ff_trusted_advisors_tenant_admin_read
on public.ff_trusted_advisors for select
using (
  exists (
    select 1
    from public.vaults v
    where v.id = ff_trusted_advisors.vault_id
      and v.tenant_id is not null
      and public.is_tenant_admin(v.tenant_id)
  )
);

-- Invite lookup by token (authenticated users accepting invite)
create policy vault_invites_select_by_token
on public.vault_invites for select
using (
  public.is_vault_member(vault_id)
  or invited_by = auth.uid()
  or (
    tenant_id is not null
    and public.is_tenant_admin(tenant_id)
  )
  or (
    auth.uid() is not null
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

-- ---------------------------------------------------------------------------
-- Demo tenant seed
-- ---------------------------------------------------------------------------
insert into public.tenants (name, subdomain, brand_color_hex, available_credits, logo_url)
values (
  'Whitfield & Cole CPAs',
  'demo',
  '#E67E50',
  10,
  null
)
on conflict (subdomain) do update
set
  available_credits = greatest(public.tenants.available_credits, 10),
  brand_color_hex = excluded.brand_color_hex;
