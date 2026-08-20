-- Spec B7: analytics boards (saved metric bundles) + client sharing

create table if not exists public.treasury_analytics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  items jsonb not null default '[]'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'shared', 'archived')),
  shared_at timestamptz,
  shared_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists treasury_analytics_client_status_idx
  on public.treasury_analytics (client_user_id, status);

create trigger treasury_analytics_set_updated_at
before update on public.treasury_analytics
for each row execute function public.set_updated_at();

alter table public.treasury_analytics enable row level security;

-- Load-bearing isolation: client session client only (never admin bypass for reads).
create policy treasury_analytics_client_shared_select
  on public.treasury_analytics
  for select
  to authenticated
  using (status = 'shared' and client_user_id = auth.uid());

comment on table public.treasury_analytics is
  'Spec B7: operator-curated metric boards; client sees only status=shared via RLS.';

comment on policy treasury_analytics_client_shared_select on public.treasury_analytics is
  'Client isolation boundary: shared boards for auth.uid() only.';
