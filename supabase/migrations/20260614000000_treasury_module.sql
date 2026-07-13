-- Treasury module: Plaid items, cached accounts, per-client envelope DEK mapping (Vault-backed)

create extension if not exists supabase_vault with schema vault;

-- ---------------------------------------------------------------------------
-- Register treasury module
-- ---------------------------------------------------------------------------
insert into public.modules (slug, name, status, default_billing_mode, route_base)
values ('treasury', 'Treasury', 'beta', 'distributor_credits', '/treasury')
on conflict (slug) do nothing;

insert into public.operator_modules (distributor_tenant_id, module_id, allowed)
select t.id, m.id, true
from public.tenants t
cross join public.modules m
where m.slug = 'treasury'
  and m.status in ('active', 'beta')
  and coalesce(t.is_house, false) = false
  and not exists (
    select 1
    from public.operator_modules om
    where om.distributor_tenant_id = t.id
      and om.module_id = m.id
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Per-client DEK mapping (DEK bytes live in Supabase Vault, not in this table)
-- ---------------------------------------------------------------------------
create table public.client_encryption_keys (
  client_user_id uuid primary key references auth.users (id) on delete cascade,
  dek_secret_id uuid not null,
  created_at timestamptz not null default now()
);

comment on table public.client_encryption_keys is
  'Maps each client to their Vault secret holding a 32-byte DEK (base64). Envelope encryption for Treasury tokens and BCN payloads.';

-- ---------------------------------------------------------------------------
-- Plaid items (access_token stored as AES-GCM ciphertext under client DEK)
-- ---------------------------------------------------------------------------
create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users (id) on delete cascade,
  distributor_tenant_id uuid references public.tenants (id) on delete set null,
  plaid_item_id text not null,
  institution_name text,
  access_token_ciphertext text not null,
  created_at timestamptz not null default now(),
  unique (client_user_id, plaid_item_id)
);

create index plaid_items_client_user_idx on public.plaid_items (client_user_id);

comment on column public.plaid_items.access_token_ciphertext is
  'AES-256-GCM envelope ciphertext (iv||tag||data) under the client DEK. Never plaintext.';

-- ---------------------------------------------------------------------------
-- Cached treasury account snapshots (non-secret; safe for owner SELECT via RLS)
-- ---------------------------------------------------------------------------
create table public.treasury_accounts (
  id uuid primary key default gen_random_uuid(),
  plaid_item_id uuid not null references public.plaid_items (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  account_id text not null,
  name text,
  mask text,
  type text,
  subtype text,
  current_balance numeric,
  available_balance numeric,
  iso_currency_code text,
  updated_at timestamptz not null default now(),
  unique (plaid_item_id, account_id)
);

create index treasury_accounts_client_user_idx on public.treasury_accounts (client_user_id);

create trigger treasury_accounts_set_updated_at
before update on public.treasury_accounts
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Vault helpers (service-role / security-definer only; never expose to clients)
-- ---------------------------------------------------------------------------
create or replace function public.internal_vault_create_secret(
  p_secret text,
  p_name text,
  p_description text default null
)
returns uuid
language sql
security definer
set search_path = vault, public
as $$
  select vault.create_secret(p_secret, p_name, p_description);
$$;

create or replace function public.internal_vault_read_secret(p_id uuid)
returns text
language sql
security definer
set search_path = vault, public
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = p_id
  limit 1;
$$;

create or replace function public.internal_vault_delete_secret(p_id uuid)
returns void
language sql
security definer
set search_path = vault, public
as $$
  delete from vault.secrets where id = p_id;
$$;

revoke all on function public.internal_vault_create_secret(text, text, text) from public;
revoke all on function public.internal_vault_create_secret(text, text, text) from anon;
revoke all on function public.internal_vault_create_secret(text, text, text) from authenticated;

revoke all on function public.internal_vault_read_secret(uuid) from public;
revoke all on function public.internal_vault_read_secret(uuid) from anon;
revoke all on function public.internal_vault_read_secret(uuid) from authenticated;

revoke all on function public.internal_vault_delete_secret(uuid) from public;
revoke all on function public.internal_vault_delete_secret(uuid) from anon;
revoke all on function public.internal_vault_delete_secret(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.client_encryption_keys enable row level security;
alter table public.plaid_items enable row level security;
alter table public.treasury_accounts enable row level security;

-- client_encryption_keys: no policies for authenticated (service-role writes only)

create policy plaid_items_owner_select on public.plaid_items
for select to authenticated
using (client_user_id = auth.uid());

create policy treasury_accounts_owner_select on public.treasury_accounts
for select to authenticated
using (client_user_id = auth.uid());

-- Writes to all three tables: service-role only (API routes after RBAC guard)
