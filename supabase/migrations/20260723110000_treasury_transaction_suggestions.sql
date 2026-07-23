-- Spec 58 Phase 1 — multi-suggestion model.
-- Pending proposals live in treasury_transaction_suggestions (many per tx).
-- Filter spine: has_pending_suggestion boolean on treasury_transactions,
-- maintained by trigger (PostgREST cannot anti-join NOT EXISTS cleanly).
-- Three ledger states (paginated, same predicate as needs_label_count RPC):
--   uncategorised / needs_label: label IS null AND has_pending_suggestion = false
--   suggested:                   label IS null AND has_pending_suggestion = true
--   confirmed / labeled:         label IS NOT null

-- ── 1. Suggestions table (mirror treasury_rule_rejections) ─────────────────
create table if not exists public.treasury_transaction_suggestions (
  transaction_id uuid not null references public.treasury_transactions (id) on delete cascade,
  rule_id        uuid not null references public.treasury_rules (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  suggested_label text not null,
  suggestion_explanation text,
  created_at timestamptz not null default now(),
  primary key (transaction_id, rule_id)
);

create index if not exists treasury_tx_suggestions_rule_idx
  on public.treasury_transaction_suggestions (client_user_id, rule_id);
create index if not exists treasury_tx_suggestions_tx_idx
  on public.treasury_transaction_suggestions (transaction_id);

alter table public.treasury_transaction_suggestions enable row level security;

drop policy if exists treasury_tx_suggestions_owner_select
  on public.treasury_transaction_suggestions;
create policy treasury_tx_suggestions_owner_select
  on public.treasury_transaction_suggestions
  for select to authenticated
  using (
    exists (
      select 1 from public.treasury_transactions t
      where t.id = transaction_id and t.client_user_id = auth.uid()
    )
  );

-- ── 2. Denormalized EXISTS flag for PostgREST filters ──────────────────────
alter table public.treasury_transactions
  add column if not exists has_pending_suggestion boolean not null default false;

create index if not exists treasury_tx_pending_suggestion_idx
  on public.treasury_transactions (client_user_id, has_pending_suggestion)
  where is_removed = false and label is null;

create or replace function public.treasury_sync_has_pending_suggestion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx uuid;
begin
  v_tx := coalesce(NEW.transaction_id, OLD.transaction_id);
  update public.treasury_transactions t
  set has_pending_suggestion = exists (
    select 1 from public.treasury_transaction_suggestions s
    where s.transaction_id = v_tx
  )
  where t.id = v_tx;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists treasury_tx_suggestions_sync_pending
  on public.treasury_transaction_suggestions;
create trigger treasury_tx_suggestions_sync_pending
  after insert or update or delete on public.treasury_transaction_suggestions
  for each row execute function public.treasury_sync_has_pending_suggestion();

-- ── 3. Move existing pending suggestions off the tx row ────────────────────
insert into public.treasury_transaction_suggestions
  (transaction_id, rule_id, client_user_id, suggested_label, suggestion_explanation, created_at)
select t.id, t.suggested_by_rule_id, t.client_user_id, t.suggested_label, t.suggestion_explanation, now()
from public.treasury_transactions t
where t.suggestion_status = 'suggested'
  and t.suggested_by_rule_id is not null
  and t.suggested_label is not null
on conflict do nothing;

-- Clear pending state from tx (keep suggested_by_rule_id on confirmed rows)
update public.treasury_transactions
set suggested_label = null,
    suggestion_status = null,
    suggestion_explanation = null
where suggestion_status = 'suggested';

-- Backfill flag from table (covers migrated rows + any race)
update public.treasury_transactions t
set has_pending_suggestion = exists (
  select 1 from public.treasury_transaction_suggestions s
  where s.transaction_id = t.id
);

-- ── 4. Portfolio RPC — same spine as Transactions Uncategorised chip ───────
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
            split_part(u.email, '@', 1)
          ),
          'status', cma.status,
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
          -- Spec 58: uncategorised = label null AND NOT EXISTS suggestion
          -- (has_pending_suggestion is the denormalized anti-join)
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
        left join public.treasury_client_operator_profile prof
          on prof.distributor_tenant_id = cma.distributor_tenant_id
         and prof.client_user_id = cma.client_user_id
        where cma.distributor_tenant_id = p_tenant_id
          and cma.module_id = v_treasury_module_id
          and cma.status = 'active'
      ) clients
    ),
    '[]'::jsonb
  );
end;
$$;
