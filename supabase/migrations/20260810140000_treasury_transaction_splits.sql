-- Spec 65 Commit 5: transaction splits + sum invariant + loader precedence

create table if not exists public.treasury_transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.treasury_transactions (id) on delete cascade,
  label text not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists treasury_transaction_splits_tx_idx
  on public.treasury_transaction_splits (transaction_id);

create trigger treasury_transaction_splits_set_updated_at
before update on public.treasury_transaction_splits
for each row execute function public.set_updated_at();

alter table public.treasury_transaction_splits enable row level security;
-- no policies: operator-only via grant-checked service routes

create or replace function public.treasury_transaction_splits_check_sum()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx_id uuid;
  v_tx_amount numeric;
  v_slice_count bigint;
  v_slice_sum numeric;
begin
  v_tx_id := coalesce(new.transaction_id, old.transaction_id);

  select t.amount into v_tx_amount
  from public.treasury_transactions t
  where t.id = v_tx_id;

  if v_tx_amount is null then
    raise exception 'treasury_transaction_splits: transaction % not found', v_tx_id;
  end if;

  select count(*)::bigint, coalesce(sum(s.amount), 0)
  into v_slice_count, v_slice_sum
  from public.treasury_transaction_splits s
  where s.transaction_id = v_tx_id;

  if v_slice_count = 0 then
    return coalesce(new, old);
  end if;

  if abs(v_slice_sum - v_tx_amount) > 0.01 then
    raise exception
      'treasury_transaction_splits: slices sum to % but transaction amount is % (±0.01)',
      v_slice_sum,
      v_tx_amount;
  end if;

  return coalesce(new, old);
end;
$$;

create constraint trigger treasury_transaction_splits_sum_invariant
after insert or update or delete on public.treasury_transaction_splits
deferrable initially deferred
for each row
execute function public.treasury_transaction_splits_check_sum();

create or replace function public.treasury_replace_transaction_splits(
  p_transaction_id uuid,
  p_slices jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elem jsonb;
  v_label text;
  v_amount numeric;
begin
  delete from public.treasury_transaction_splits
  where transaction_id = p_transaction_id;

  if p_slices is null or jsonb_typeof(p_slices) <> 'array' or jsonb_array_length(p_slices) = 0 then
    return;
  end if;

  for v_elem in select value from jsonb_array_elements(p_slices) as t(value)
  loop
    v_label := nullif(trim(v_elem->>'label'), '');
    v_amount := (v_elem->>'amount')::numeric;
    if v_label is null then
      raise exception 'treasury_replace_transaction_splits: label required on each slice';
    end if;
    if v_amount is null then
      raise exception 'treasury_replace_transaction_splits: amount required on each slice';
    end if;
    insert into public.treasury_transaction_splits (transaction_id, label, amount)
    values (p_transaction_id, v_label, v_amount);
  end loop;

  -- Split tx uses slices only — clear single-label to avoid dual semantics.
  update public.treasury_transactions
  set label = null,
      label_source = null,
      labeled_by = null,
      labeled_at = null
  where id = p_transaction_id;
end;
$$;

revoke all on function public.treasury_replace_transaction_splits(uuid, jsonb) from public;
grant execute on function public.treasury_replace_transaction_splits(uuid, jsonb) to service_role;
grant execute on function public.treasury_replace_transaction_splits(uuid, jsonb) to authenticated;

-- Spec 65 — splits replace single-label in category series (never double-count)
create or replace function public.treasury_monthly_by_category(
  p_client uuid,
  p_account_id text,
  p_from date,
  p_to date,
  p_direction text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with tx_base as (
    select
      t.id,
      t.label,
      t.direction,
      t.amount,
      t.posted_date
    from public.treasury_transactions t
    where t.client_user_id = p_client
      and t.is_removed = false
      and t.pending = false
      and t.account_id = p_account_id
      and t.posted_date >= p_from
      and t.posted_date <= p_to
      and t.direction in ('in', 'out')
      and (p_direction is null or t.direction = p_direction)
  ),
  unsplit as (
    select
      coalesce(nullif(trim(t.label), ''), '__uncategorized__') as label_key,
      t.direction as direction_key,
      (date_trunc('month', t.posted_date::timestamp)::date)::text as month_key,
      abs(t.amount)::float8 as contrib
    from tx_base t
    where not exists (
      select 1
      from public.treasury_transaction_splits s
      where s.transaction_id = t.id
    )
  ),
  split_rows as (
    select
      coalesce(nullif(trim(s.label), ''), '__uncategorized__') as label_key,
      t.direction as direction_key,
      (date_trunc('month', t.posted_date::timestamp)::date)::text as month_key,
      abs(s.amount)::float8 as contrib
    from tx_base t
    join public.treasury_transaction_splits s on s.transaction_id = t.id
  ),
  combined as (
    select * from unsplit
    union all
    select * from split_rows
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'label', label_key,
        'direction', direction_key,
        'month', month_key,
        'total', total
      )
      order by label_key, direction_key, month_key
    ),
    '[]'::jsonb
  )
  from (
    select label_key, direction_key, month_key, sum(contrib) as total
    from combined
    group by 1, 2, 3
  ) agg;
$$;

revoke all on function public.treasury_monthly_by_category(uuid, text, date, date, text) from public;
grant execute on function public.treasury_monthly_by_category(uuid, text, date, date, text) to service_role;
grant execute on function public.treasury_monthly_by_category(uuid, text, date, date, text) to authenticated;
