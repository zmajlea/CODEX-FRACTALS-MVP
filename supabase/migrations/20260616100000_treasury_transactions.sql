-- Treasury transactions persistence + account source extensions

create extension if not exists pg_trgm;

-- Forward-compat for KMS migration path (no behavior change)
alter table public.client_encryption_keys
  add column if not exists key_provider text not null default 'supabase_vault';

alter table public.plaid_items
  add column if not exists transactions_cursor text,
  add column if not exists transactions_last_synced_at timestamptz;

alter table public.treasury_accounts
  add column if not exists source text not null default 'plaid';

alter table public.treasury_accounts
  alter column plaid_item_id drop not null;

alter table public.treasury_accounts
  drop constraint if exists treasury_accounts_plaid_item_id_account_id_key;

alter table public.treasury_accounts
  add constraint treasury_accounts_client_account_unique unique (client_user_id, account_id);

create table if not exists public.treasury_transactions (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users (id) on delete cascade,
  source text not null default 'plaid' check (source in ('plaid', 'csv')),
  plaid_item_id uuid references public.plaid_items (id) on delete cascade,
  account_id text not null,
  external_id text not null,
  pending_external_id text,
  posted_date date,
  authorized_date date,
  amount numeric not null,
  direction text check (direction in ('in', 'out')),
  iso_currency_code text,
  raw_name text,
  merchant_name text,
  normalized_merchant text,
  plaid_category text,
  pending boolean not null default false,
  is_removed boolean not null default false,
  label text,
  description text,
  label_source text check (label_source in ('manual', 'rule_confirmed')),
  labeled_by uuid references auth.users (id) on delete set null,
  labeled_at timestamptz,
  suggested_label text,
  suggested_by_rule_id uuid,
  suggestion_status text check (suggestion_status in ('suggested', 'confirmed', 'rejected')),
  suggestion_explanation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_user_id, source, external_id)
);

create index treasury_transactions_client_posted_idx
  on public.treasury_transactions (client_user_id, posted_date desc);

create index treasury_transactions_client_merchant_idx
  on public.treasury_transactions (client_user_id, normalized_merchant);

create index treasury_transactions_client_label_idx
  on public.treasury_transactions (client_user_id, label)
  where label is not null;

create index treasury_transactions_merchant_trgm_idx
  on public.treasury_transactions using gin (normalized_merchant gin_trgm_ops);

create trigger treasury_transactions_set_updated_at
before update on public.treasury_transactions
for each row execute function public.set_updated_at();

alter table public.treasury_transactions enable row level security;

create policy treasury_transactions_owner_select on public.treasury_transactions
for select to authenticated
using (client_user_id = auth.uid());
