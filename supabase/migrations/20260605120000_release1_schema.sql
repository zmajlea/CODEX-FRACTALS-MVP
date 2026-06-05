-- Release 1: governance, audit, inbox, ingestion, revisioning, alerts

create type public.invite_status as enum (
  'pending',
  'accepted',
  'rejected',
  'revoked'
);

create type public.ingestion_job_status as enum (
  'uploading',
  'queued',
  'scanning',
  'complete',
  'partial',
  'failed',
  'cancelled'
);

create type public.ingestion_file_status as enum (
  'uploading',
  'queued',
  'scanning',
  'complete',
  'failed',
  'cancelled'
);

create type public.proposal_status as enum (
  'proposed',
  'approved',
  'dismissed'
);

create table if not exists public.record_activity_events (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  record_id uuid references public.records (id) on delete set null,
  event_type text not null,
  actor_id uuid references public.users (id) on delete set null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index record_activity_events_vault_idx
  on public.record_activity_events (vault_id, created_at desc);

create table if not exists public.user_audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  event_type text not null,
  vault_id uuid references public.vaults (id) on delete set null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index user_audit_events_user_idx
  on public.user_audit_events (user_id, created_at desc);

create table if not exists public.vault_invites (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  email text not null,
  role public.user_role not null default 'USER',
  status public.invite_status not null default 'pending',
  invited_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  item_type text not null,
  title_plain text not null,
  deep_link text,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index inbox_items_user_unread_idx
  on public.inbox_items (user_id, read_at);

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  scan_mode text not null default 'doc_identifier',
  status public.ingestion_job_status not null default 'queued',
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ingestion_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ingestion_jobs (id) on delete cascade,
  file_id uuid references public.files (id) on delete set null,
  status public.ingestion_file_status not null default 'queued',
  error_plain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.doc_identifier_proposals (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  file_id uuid references public.files (id) on delete set null,
  fields_ciphertext text not null,
  status public.proposal_status not null default 'proposed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.temporal_object_versions (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null references public.temporal_objects (id) on delete cascade,
  version_number integer not null default 1,
  is_canonical boolean not null default false,
  title_ciphertext text not null,
  body_ciphertext text,
  sealed_at timestamptz,
  sealed_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  pulse_id uuid not null references public.temporal_objects (id) on delete cascade,
  schedule_at timestamptz not null,
  status text not null default 'active',
  delivery_log jsonb not null default '[]',
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.record_activity_events enable row level security;
alter table public.user_audit_events enable row level security;
alter table public.vault_invites enable row level security;
alter table public.inbox_items enable row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.ingestion_files enable row level security;
alter table public.doc_identifier_proposals enable row level security;
alter table public.temporal_object_versions enable row level security;
alter table public.alerts enable row level security;

create policy record_activity_select on public.record_activity_events
  for select using (public.is_vault_member(vault_id));

create policy record_activity_insert on public.record_activity_events
  for insert with check (public.is_vault_member(vault_id));

create policy user_audit_select on public.user_audit_events
  for select using (user_id = auth.uid());

create policy inbox_select on public.inbox_items
  for select using (user_id = auth.uid());

create policy inbox_update on public.inbox_items
  for update using (user_id = auth.uid());

create policy vault_invites_member on public.vault_invites
  for all using (public.is_vault_member(vault_id));

create policy ingestion_jobs_member on public.ingestion_jobs
  for all using (public.is_vault_member(vault_id));

create policy doc_proposals_member on public.doc_identifier_proposals
  for all using (public.is_vault_member(vault_id));

create policy alerts_member on public.alerts
  for all using (public.is_vault_member(vault_id));
