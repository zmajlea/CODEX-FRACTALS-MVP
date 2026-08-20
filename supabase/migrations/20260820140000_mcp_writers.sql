-- Spec B3 — MCP writers: proposed rules, metrics library, recommendation source

-- A · treasury_rules: proposed state + source (keep active synced for apply filter)
alter table public.treasury_rules
  add column if not exists source text;

alter table public.treasury_rules
  add column if not exists status text;

update public.treasury_rules
set status = case when active then 'active' else 'paused' end
where status is null;

alter table public.treasury_rules
  alter column status set default 'active';

alter table public.treasury_rules
  alter column status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'treasury_rules_status_check'
  ) then
    alter table public.treasury_rules
      add constraint treasury_rules_status_check
      check (status in ('active', 'paused', 'proposed', 'discarded'));
  end if;
end $$;

create index if not exists treasury_rules_status_idx
  on public.treasury_rules (client_user_id, status);

-- B · treasury_metrics
create table if not exists public.treasury_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_user_id uuid references auth.users (id) on delete cascade,
  scope text not null check (scope in ('general', 'client')),
  name text not null,
  description text not null default '',
  definition jsonb not null,
  computed_value jsonb,
  computed_at timestamptz,
  source text not null default 'platform' check (source in ('mcp', 'platform')),
  status text not null default 'active' check (status in ('active', 'discarded')),
  version int not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treasury_metrics_scope_client check (
    (scope = 'general' and client_user_id is null)
    or (scope = 'client' and client_user_id is not null)
  )
);

create unique index if not exists treasury_metrics_tenant_name_general_uidx
  on public.treasury_metrics (tenant_id, name)
  where scope = 'general' and status = 'active';

create unique index if not exists treasury_metrics_tenant_client_name_uidx
  on public.treasury_metrics (tenant_id, client_user_id, name)
  where scope = 'client' and status = 'active';

create index if not exists treasury_metrics_client_idx
  on public.treasury_metrics (client_user_id, status);

create trigger treasury_metrics_set_updated_at
before update on public.treasury_metrics
for each row execute function public.set_updated_at();

alter table public.treasury_metrics enable row level security;

-- C · recommendation source tag
alter table public.treasury_recommendations
  add column if not exists source text;
