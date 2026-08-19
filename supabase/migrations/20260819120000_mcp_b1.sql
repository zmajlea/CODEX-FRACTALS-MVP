-- Spec B1 — MCP dev tokens, audit log, external_model studies

create table if not exists public.operator_api_tokens (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  token_hash text not null,
  label text not null default 'dev',
  scopes text[] not null default array['treasury:read', 'treasury:write']::text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists operator_api_tokens_hash_uniq
  on public.operator_api_tokens (token_hash)
  where revoked_at is null;

create index if not exists operator_api_tokens_operator_idx
  on public.operator_api_tokens (operator_user_id);

alter table public.operator_api_tokens enable row level security;

create table if not exists public.mcp_audit_log (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  tool text not null,
  client_id uuid,
  ok boolean not null default true,
  error text,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists mcp_audit_log_operator_idx
  on public.mcp_audit_log (operator_user_id, created_at desc);

alter table public.mcp_audit_log enable row level security;

alter table public.treasury_studies
  add column if not exists status text not null default 'confirmed';

alter table public.treasury_studies
  add column if not exists source text;

alter table public.treasury_studies
  drop constraint if exists treasury_studies_type_check;

alter table public.treasury_studies
  add constraint treasury_studies_type_check
  check (type in ('spend_plan', 'cash_model', 'external_model'));

alter table public.treasury_studies
  drop constraint if exists treasury_studies_status_check;

alter table public.treasury_studies
  add constraint treasury_studies_status_check
  check (status in ('pending', 'confirmed', 'discarded'));
