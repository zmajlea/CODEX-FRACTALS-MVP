-- Spec B2 — MCP OAuth 2.1 authorization server tables

create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_secret_hash text,
  client_name text,
  redirect_uris text[] not null default '{}'::text[],
  grant_types text[] not null default array['authorization_code', 'refresh_token']::text[],
  token_endpoint_auth_method text not null default 'none',
  created_at timestamptz not null default now()
);

create index if not exists oauth_clients_client_id_idx on public.oauth_clients (client_id);

alter table public.oauth_clients enable row level security;

create table if not exists public.oauth_auth_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  operator_user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  scope text not null default 'treasury:read treasury:write',
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists oauth_auth_codes_client_idx
  on public.oauth_auth_codes (client_id, expires_at desc);

alter table public.oauth_auth_codes enable row level security;

create table if not exists public.oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  operator_user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  scope text not null,
  expires_at timestamptz not null,
  rotated_from uuid references public.oauth_refresh_tokens (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists oauth_refresh_tokens_operator_idx
  on public.oauth_refresh_tokens (operator_user_id, created_at desc);

alter table public.oauth_refresh_tokens enable row level security;

create table if not exists public.oauth_rate_log (
  id uuid primary key default gen_random_uuid(),
  route text not null,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists oauth_rate_log_route_ip_idx
  on public.oauth_rate_log (route, ip, created_at desc);

alter table public.oauth_rate_log enable row level security;
