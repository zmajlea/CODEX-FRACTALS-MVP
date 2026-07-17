-- Treasury studies (operator-owned Analytics artifacts; not sealed)
-- Client never reads these — service-role only via grant-checked routes. No RLS policies.

create table if not exists public.treasury_studies (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users (id) on delete cascade,
  operator_tenant_id uuid references public.tenants (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  name text not null,
  type text not null default 'spend_plan' check (type in ('spend_plan')),
  scope jsonb not null,
  params jsonb not null,
  scenarios jsonb not null,
  derived_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index treasury_studies_client_idx
  on public.treasury_studies (client_user_id, type);

create trigger treasury_studies_set_updated_at
before update on public.treasury_studies
for each row execute function public.set_updated_at();

alter table public.treasury_studies enable row level security;
-- no policies: operator-only, service-role writes through grant-checked routes
