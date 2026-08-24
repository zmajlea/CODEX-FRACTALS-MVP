-- Spec B10: onboarding + client portal safety floor
-- distributor_client_invites (treasury, no vault/credits)
-- grant helper + RLS AND
-- thread attachments + client documents
-- roster includes non-active grants; reactivate RPC

-- ---------------------------------------------------------------------------
-- Part B: distributor_client_invites
-- ---------------------------------------------------------------------------
create table if not exists public.distributor_client_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  token_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'expired', 'revoked')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists distributor_client_invites_token_hash_uidx
  on public.distributor_client_invites (token_hash);

create index if not exists distributor_client_invites_client_status_idx
  on public.distributor_client_invites (client_user_id, status);

create index if not exists distributor_client_invites_tenant_idx
  on public.distributor_client_invites (tenant_id, status);

create trigger distributor_client_invites_set_updated_at
before update on public.distributor_client_invites
for each row execute function public.set_updated_at();

alter table public.distributor_client_invites enable row level security;

-- Operators manage invites for their tenant; clients never read invite tokens.
create policy distributor_client_invites_operator_all
  on public.distributor_client_invites
  for all
  to authenticated
  using (public.is_operator(tenant_id) or public.is_global_admin())
  with check (public.is_operator(tenant_id) or public.is_global_admin());

comment on table public.distributor_client_invites is
  'Spec B10: treasury client activation invites (hashed token; no vault/credits).';

-- ---------------------------------------------------------------------------
-- Part F: thread attachments
-- ---------------------------------------------------------------------------
create table if not exists public.treasury_thread_attachments (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null
    references public.treasury_recommendations (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  filename text not null,
  content_type text,
  byte_size integer,
  created_at timestamptz not null default now()
);

create index if not exists treasury_thread_attachments_rec_idx
  on public.treasury_thread_attachments (recommendation_id);

create index if not exists treasury_thread_attachments_client_idx
  on public.treasury_thread_attachments (client_user_id);

alter table public.treasury_thread_attachments enable row level security;

-- ---------------------------------------------------------------------------
-- Part E: client documents (PDF / print exports listed for client)
-- ---------------------------------------------------------------------------
create table if not exists public.treasury_client_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  kind text not null default 'analytics_pdf',
  analytics_id uuid references public.treasury_analytics (id) on delete set null,
  print_path text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists treasury_client_documents_client_idx
  on public.treasury_client_documents (client_user_id, created_at desc);

alter table public.treasury_client_documents enable row level security;

-- ---------------------------------------------------------------------------
-- Part C: active treasury grant helper (safety floor)
-- ---------------------------------------------------------------------------
create or replace function public.has_active_treasury_grant()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_module_access cma
    join public.modules m on m.id = cma.module_id
    where cma.client_user_id = auth.uid()
      and m.slug = 'treasury'
      and cma.status = 'active'
  );
$$;

revoke all on function public.has_active_treasury_grant() from public;
grant execute on function public.has_active_treasury_grant() to authenticated;

comment on function public.has_active_treasury_grant() is
  'Spec B10: client SELECT policies require an active treasury grant.';

-- Tighten existing client SELECTs
drop policy if exists treasury_accounts_owner_select on public.treasury_accounts;
create policy treasury_accounts_owner_select on public.treasury_accounts
for select to authenticated
using (
  client_user_id = auth.uid()
  and public.has_active_treasury_grant()
);

drop policy if exists treasury_recommendations_owner_select on public.treasury_recommendations;
create policy treasury_recommendations_owner_select on public.treasury_recommendations
for select to authenticated
using (
  client_user_id = auth.uid()
  and status <> 'draft'
  and public.has_active_treasury_grant()
);

-- Client may update own non-draft rows (answer / accept / decline / mark_seen)
drop policy if exists treasury_recommendations_owner_update on public.treasury_recommendations;
create policy treasury_recommendations_owner_update on public.treasury_recommendations
for update to authenticated
using (
  client_user_id = auth.uid()
  and status <> 'draft'
  and public.has_active_treasury_grant()
)
with check (
  client_user_id = auth.uid()
  and status <> 'draft'
  and public.has_active_treasury_grant()
);

-- Client may insert own questions (never draft)
drop policy if exists treasury_recommendations_owner_insert on public.treasury_recommendations;
create policy treasury_recommendations_owner_insert on public.treasury_recommendations
for insert to authenticated
with check (
  client_user_id = auth.uid()
  and status <> 'draft'
  and kind = 'question'
  and public.has_active_treasury_grant()
);

drop policy if exists treasury_analytics_client_shared_select on public.treasury_analytics;
create policy treasury_analytics_client_shared_select
  on public.treasury_analytics
  for select
  to authenticated
  using (
    status = 'shared'
    and client_user_id = auth.uid()
    and public.has_active_treasury_grant()
  );

-- Attachments: client own rows; operator via grant (service role / admin also used)
create policy treasury_thread_attachments_client_select
  on public.treasury_thread_attachments
  for select to authenticated
  using (
    client_user_id = auth.uid()
    and public.has_active_treasury_grant()
  );

create policy treasury_thread_attachments_client_insert
  on public.treasury_thread_attachments
  for insert to authenticated
  with check (
    client_user_id = auth.uid()
    and public.has_active_treasury_grant()
  );

create policy treasury_thread_attachments_operator_select
  on public.treasury_thread_attachments
  for select to authenticated
  using (
    exists (
      select 1
      from public.treasury_recommendations r
      where r.id = recommendation_id
        and (
          public.is_operator(r.operator_tenant_id)
          or public.is_global_admin()
        )
    )
  );

-- Documents
create policy treasury_client_documents_client_select
  on public.treasury_client_documents
  for select to authenticated
  using (
    client_user_id = auth.uid()
    and public.has_active_treasury_grant()
  );

create policy treasury_client_documents_operator_all
  on public.treasury_client_documents
  for all to authenticated
  using (public.is_operator(tenant_id) or public.is_global_admin())
  with check (public.is_operator(tenant_id) or public.is_global_admin());

-- Ensure client_response exists (idempotent; added in B10 confirm)
alter table public.treasury_recommendations
  add column if not exists client_response text;

-- ---------------------------------------------------------------------------
-- Part G: roster includes invited/suspended/revoked + invite chip
-- ---------------------------------------------------------------------------
create or replace function public.list_operator_treasury_clients(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_treasury_module_id uuid;
begin
  if not public.is_operator(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  select id into v_treasury_module_id
  from public.modules
  where slug = 'treasury'
  limit 1;

  if v_treasury_module_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(row order by (row ->> 'client_name') asc nulls last)
      from (
        select jsonb_build_object(
          'grant_id', cma.id,
          'client_user_id', cma.client_user_id,
          'client_email', u.email,
          'client_name', coalesce(
            nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
            nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
            nullif(trim(pu.display_name), ''),
            split_part(u.email, '@', 1)
          ),
          'status', cma.status,
          'invite_status', (
            select dci.status
            from public.distributor_client_invites dci
            where dci.client_user_id = cma.client_user_id
              and dci.tenant_id = p_tenant_id
            order by dci.created_at desc
            limit 1
          ),
          'institution_count', (
            select count(*)::int
            from public.plaid_items pi
            where pi.client_user_id = cma.client_user_id
          ),
          'account_count', (
            select count(*)::int
            from public.treasury_accounts ta
            where ta.client_user_id = cma.client_user_id
          ),
          'total_cash', coalesce((
            select sum(ta.current_balance)
            from public.treasury_accounts ta
            where ta.client_user_id = cma.client_user_id
          ), 0),
          'total_cash_by_currency', coalesce((
            select jsonb_object_agg(currency, total)
            from (
              select
                coalesce(ta.iso_currency_code, 'USD') as currency,
                sum(ta.current_balance) as total
              from public.treasury_accounts ta
              where ta.client_user_id = cma.client_user_id
              group by coalesce(ta.iso_currency_code, 'USD')
            ) sums
          ), '{}'::jsonb),
          'last_synced_at', (
            select max(ta.updated_at)
            from public.treasury_accounts ta
            where ta.client_user_id = cma.client_user_id
          ),
          'needs_label_count', (
            select count(*)::int
            from public.treasury_transactions tt
            where tt.client_user_id = cma.client_user_id
              and tt.is_removed = false
              and tt.label is null
              and tt.has_pending_suggestion = false
          ),
          'industry', prof.industry,
          'next_note', prof.next_note,
          'watch_note', prof.watch_note,
          'attention_reason', prof.attention_reason
        ) as row
        from public.client_module_access cma
        join auth.users u on u.id = cma.client_user_id
        left join public.users pu on pu.id = cma.client_user_id
        left join public.treasury_client_operator_profile prof
          on prof.distributor_tenant_id = cma.distributor_tenant_id
         and prof.client_user_id = cma.client_user_id
        where cma.distributor_tenant_id = p_tenant_id
          and cma.module_id = v_treasury_module_id
          and cma.status in ('active', 'suspended', 'revoked')
      ) clients
    ),
    '[]'::jsonb
  );
end;
$$;

-- Reactivate suspended grant
create or replace function public.reactivate_operator_client_access(p_grant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.client_module_access;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_grant
  from public.client_module_access
  where id = p_grant_id
  for update;

  if not found then
    raise exception 'Grant not found';
  end if;

  if not public.is_operator(v_grant.distributor_tenant_id)
     and not public.is_global_admin() then
    raise exception 'Not authorized';
  end if;

  if v_grant.status = 'revoked' then
    raise exception 'Revoked grants cannot be reactivated';
  end if;

  if v_grant.status = 'active' then
    return jsonb_build_object('grant_id', v_grant.id, 'status', 'active');
  end if;

  update public.client_module_access
  set status = 'active'
  where id = p_grant_id;

  return jsonb_build_object('grant_id', p_grant_id, 'status', 'active');
end;
$$;

grant execute on function public.reactivate_operator_client_access(uuid) to authenticated;

-- Storage bucket for thread attachments (private)
insert into storage.buckets (id, name, public, file_size_limit)
values ('treasury-thread', 'treasury-thread', false, 10485760)
on conflict (id) do nothing;

-- Path: {client_user_id}/{recommendation_id}/{filename}
-- Client may read/write only under their own uid prefix when grant is active.
drop policy if exists treasury_thread_storage_select on storage.objects;
create policy treasury_thread_storage_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'treasury-thread'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.has_active_treasury_grant()
);

drop policy if exists treasury_thread_storage_insert on storage.objects;
create policy treasury_thread_storage_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'treasury-thread'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.has_active_treasury_grant()
);
