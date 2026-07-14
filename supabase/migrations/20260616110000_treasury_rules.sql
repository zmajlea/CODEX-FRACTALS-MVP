-- Treasury rules + sticky rejections

create table if not exists public.treasury_rules (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  name text not null,
  match_merchant text not null,
  match_type text not null default 'contains' check (match_type in ('exact', 'contains', 'fuzzy')),
  amount_min numeric,
  amount_max numeric,
  direction text check (direction in ('in', 'out')),
  cadence text,
  assign_label text not null,
  active boolean not null default true,
  source_transaction_id uuid references public.treasury_transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index treasury_rules_client_idx on public.treasury_rules (client_user_id, active);

create trigger treasury_rules_set_updated_at
before update on public.treasury_rules
for each row execute function public.set_updated_at();

create table if not exists public.treasury_rule_rejections (
  transaction_id uuid not null references public.treasury_transactions (id) on delete cascade,
  rule_id uuid not null references public.treasury_rules (id) on delete cascade,
  rejected_by uuid references auth.users (id) on delete set null,
  rejected_at timestamptz not null default now(),
  primary key (transaction_id, rule_id)
);

alter table public.treasury_transactions
  add constraint treasury_transactions_suggested_rule_fkey
  foreign key (suggested_by_rule_id) references public.treasury_rules (id) on delete set null;

alter table public.treasury_rules enable row level security;
alter table public.treasury_rule_rejections enable row level security;

create policy treasury_rules_owner_select on public.treasury_rules
for select to authenticated
using (client_user_id = auth.uid());

create policy treasury_rule_rejections_owner_select on public.treasury_rule_rejections
for select to authenticated
using (
  exists (
    select 1 from public.treasury_transactions t
    where t.id = transaction_id and t.client_user_id = auth.uid()
  )
);
