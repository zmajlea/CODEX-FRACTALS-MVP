-- Fractals MVP: initial schema with vault-scoped RLS
-- Apply in Supabase SQL Editor or via: supabase db push

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('SUPER_ADMIN', 'ADMIN', 'USER', 'CLIENT');

create type public.record_status as enum (
  'draft',
  'active',
  'archived',
  'sealed'
);

create type public.temporal_object_kind as enum (
  'date',
  'party',
  'obligation',
  'definition',
  'clause',
  'amount',
  'other'
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- users (profile; id mirrors auth.users)
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- vaults
-- ---------------------------------------------------------------------------
create table public.vaults (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.users (id) on delete set null,
  encryption_test text,
  encryption_test_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger vaults_set_updated_at
before update on public.vaults
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- vault_members (RBAC)
-- ---------------------------------------------------------------------------
create table public.vault_members (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.user_role not null default 'USER',
  invited_email text,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vault_id, user_id)
);

create index vault_members_user_id_idx on public.vault_members (user_id);
create index vault_members_vault_id_idx on public.vault_members (vault_id);

create trigger vault_members_set_updated_at
before update on public.vault_members
for each row execute function public.set_updated_at();

-- RLS helpers (must be created after vault_members — SQL functions validate table refs at create time)
create or replace function public.is_vault_member(p_vault_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.vault_members vm
    where vm.vault_id = p_vault_id
      and vm.user_id = auth.uid()
  );
$$;

create or replace function public.is_vault_admin(p_vault_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.vault_members vm
    where vm.vault_id = p_vault_id
      and vm.user_id = auth.uid()
      and vm.role in ('SUPER_ADMIN', 'ADMIN')
  );
$$;

-- ---------------------------------------------------------------------------
-- records (agreements / ledger entries per vault)
-- ---------------------------------------------------------------------------
create table public.records (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  created_by uuid references public.users (id) on delete set null,
  title_ciphertext text,
  title_plain text,
  record_type text,
  counterparty_ciphertext text,
  status public.record_status not null default 'draft',
  effective_date date,
  expiry_date date,
  encrypted boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index records_vault_id_idx on public.records (vault_id);
create index records_status_idx on public.records (status);

create trigger records_set_updated_at
before update on public.records
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- files (PDFs / attachments; ciphertext in storage, metadata here)
-- ---------------------------------------------------------------------------
create table public.files (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  record_id uuid not null references public.records (id) on delete cascade,
  uploaded_by uuid references public.users (id) on delete set null,
  storage_path text not null,
  file_name_ciphertext text,
  mime_type text,
  byte_size bigint,
  encrypted boolean not null default true,
  checksum_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index files_vault_id_idx on public.files (vault_id);
create index files_record_id_idx on public.files (record_id);

create trigger files_set_updated_at
before update on public.files
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- temporal_objects (AI-extracted ledger objects; E2E ciphertext fields)
-- ---------------------------------------------------------------------------
create table public.temporal_objects (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  record_id uuid not null references public.records (id) on delete cascade,
  file_id uuid references public.files (id) on delete set null,
  created_by uuid references public.users (id) on delete set null,
  kind public.temporal_object_kind not null default 'other',
  title_ciphertext text not null,
  body_ciphertext text,
  page_number integer,
  start_offset integer,
  end_offset integer,
  zone_index integer,
  verified_at timestamptz,
  verified_by uuid references public.users (id) on delete set null,
  encrypted boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index temporal_objects_vault_id_idx on public.temporal_objects (vault_id);
create index temporal_objects_record_id_idx on public.temporal_objects (record_id);

create trigger temporal_objects_set_updated_at
before update on public.temporal_objects
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auth hook: provision public.users on signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.users.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.users.avatar_url),
    updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.vaults enable row level security;
alter table public.vault_members enable row level security;
alter table public.records enable row level security;
alter table public.files enable row level security;
alter table public.temporal_objects enable row level security;

-- users: own profile
create policy users_select_own
on public.users for select
using (id = auth.uid());

create policy users_update_own
on public.users for update
using (id = auth.uid())
with check (id = auth.uid());

create policy users_insert_own
on public.users for insert
with check (id = auth.uid());

-- vaults: members can read; creator+member flow on insert
create policy vaults_select_member
on public.vaults for select
using (public.is_vault_member(id));

create policy vaults_select_own
on public.vaults for select
using (created_by = auth.uid());

create policy vaults_insert_authenticated
on public.vaults for insert
with check (auth.uid() is not null and created_by = auth.uid());

create policy vaults_update_admin
on public.vaults for update
using (public.is_vault_admin(id))
with check (public.is_vault_admin(id));

-- vault_members
create policy vault_members_select_member
on public.vault_members for select
using (public.is_vault_member(vault_id));

create policy vault_members_insert_self_or_admin
on public.vault_members for insert
with check (
  user_id = auth.uid()
  or public.is_vault_admin(vault_id)
);

create policy vault_members_update_admin
on public.vault_members for update
using (public.is_vault_admin(vault_id))
with check (public.is_vault_admin(vault_id));

create policy vault_members_delete_admin
on public.vault_members for delete
using (public.is_vault_admin(vault_id));

-- records: vault membership required
create policy records_select_member
on public.records for select
using (public.is_vault_member(vault_id));

create policy records_insert_member
on public.records for insert
with check (
  public.is_vault_member(vault_id)
  and (created_by is null or created_by = auth.uid())
);

create policy records_update_member
on public.records for update
using (public.is_vault_member(vault_id))
with check (public.is_vault_member(vault_id));

create policy records_delete_admin
on public.records for delete
using (public.is_vault_admin(vault_id));

-- files
create policy files_select_member
on public.files for select
using (public.is_vault_member(vault_id));

create policy files_insert_member
on public.files for insert
with check (
  public.is_vault_member(vault_id)
  and (uploaded_by is null or uploaded_by = auth.uid())
);

create policy files_update_member
on public.files for update
using (public.is_vault_member(vault_id))
with check (public.is_vault_member(vault_id));

create policy files_delete_member
on public.files for delete
using (public.is_vault_member(vault_id));

-- temporal_objects
create policy temporal_objects_select_member
on public.temporal_objects for select
using (public.is_vault_member(vault_id));

create policy temporal_objects_insert_member
on public.temporal_objects for insert
with check (
  public.is_vault_member(vault_id)
  and (created_by is null or created_by = auth.uid())
);

create policy temporal_objects_update_member
on public.temporal_objects for update
using (public.is_vault_member(vault_id))
with check (public.is_vault_member(vault_id));

create policy temporal_objects_delete_member
on public.temporal_objects for delete
using (public.is_vault_member(vault_id));

-- ---------------------------------------------------------------------------
-- Bootstrap membership when a vault is created (creator = SUPER_ADMIN)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_vault()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.vault_members (vault_id, user_id, role)
    values (new.id, new.created_by, 'SUPER_ADMIN')
    on conflict (vault_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_vault_created
after insert on public.vaults
for each row execute function public.handle_new_vault();

-- ---------------------------------------------------------------------------
-- Vault creation RPC (sets created_by server-side; avoids RLS spoofing)
-- ---------------------------------------------------------------------------
create or replace function public.create_vault(p_name text)
returns public.vaults
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_vault public.vaults;
  v_email text;
  v_name text;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Vault name is required';
  end if;

  v_email := coalesce(auth.jwt() ->> 'email', '');
  v_name := coalesce(
    auth.jwt() -> 'user_metadata' ->> 'full_name',
    auth.jwt() -> 'user_metadata' ->> 'name',
    split_part(v_email, '@', 1)
  );

  insert into public.users (id, email, display_name)
  values (v_user, v_email, v_name)
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.users.display_name),
    updated_at = now();

  insert into public.vaults (name, created_by)
  values (trim(p_name), v_user)
  returning * into v_vault;

  return v_vault;
end;
$$;

revoke all on function public.create_vault(text) from public;
grant execute on function public.create_vault(text) to authenticated;
