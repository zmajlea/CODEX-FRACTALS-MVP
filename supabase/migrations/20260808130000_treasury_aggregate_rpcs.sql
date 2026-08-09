-- Spec 67 Part B: aggregate RPCs — stop fetch-all-to-count

-- ── B1 · Per-rule queue counts ───────────────────────────────────────────────
create or replace function public.treasury_rule_queue_counts(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with suggested as (
    select s.rule_id, count(*)::int as n
    from public.treasury_transaction_suggestions s
    join public.treasury_transactions t
      on t.id = s.transaction_id
     and t.client_user_id = p_client
     and t.is_removed = false
     and t.label is null
    where s.client_user_id = p_client
    group by s.rule_id
  ),
  confirmed as (
    select t.suggested_by_rule_id as rule_id, count(*)::int as n
    from public.treasury_transactions t
    where t.client_user_id = p_client
      and t.is_removed = false
      and t.label_source = 'rule_confirmed'
      and t.suggested_by_rule_id is not null
    group by t.suggested_by_rule_id
  ),
  rule_ids as (
    select rule_id from suggested
    union
    select rule_id from confirmed
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rule_id', r.rule_id,
        'suggested', coalesce(s.n, 0),
        'confirmed', coalesce(c.n, 0)
      )
      order by r.rule_id
    ),
    '[]'::jsonb
  )
  from rule_ids r
  left join suggested s on s.rule_id = r.rule_id
  left join confirmed c on c.rule_id = r.rule_id;
$$;

revoke all on function public.treasury_rule_queue_counts(uuid) from public;
grant execute on function public.treasury_rule_queue_counts(uuid) to service_role;
grant execute on function public.treasury_rule_queue_counts(uuid) to authenticated;

create index if not exists treasury_tx_confirmed_by_rule_idx
  on public.treasury_transactions (client_user_id, suggested_by_rule_id)
  where label_source = 'rule_confirmed' and is_removed = false;

-- ── B2 · Period summary (replaces fetch-all + JS aggregate) ────────────────
create or replace function public.treasury_query_summary(
  p_client uuid,
  p_bucket text,
  p_from date default null,
  p_to date default null,
  p_account_id text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      t.posted_date,
      t.amount,
      t.direction,
      coalesce(nullif(t.iso_currency_code, ''), 'USD') as currency,
      case
        when p_bucket = 'day' then t.posted_date
        when p_bucket = 'week' then (date_trunc('week', t.posted_date::timestamp)::date)
        when p_bucket = 'month' then (date_trunc('month', t.posted_date::timestamp)::date)
        else (date_trunc('year', t.posted_date::timestamp)::date)
      end as period_start
    from public.treasury_transactions t
    where t.client_user_id = p_client
      and t.is_removed = false
      and t.pending = false
      and t.posted_date is not null
      and t.direction in ('in', 'out')
      and (p_from is null or t.posted_date >= p_from)
      and (p_to is null or t.posted_date <= p_to)
      and (p_account_id is null or t.account_id = p_account_id)
  ),
  agg as (
    select
      period_start,
      currency as iso_currency_code,
      coalesce(sum(abs(amount)) filter (where direction = 'in'), 0)::float8 as inflow,
      coalesce(sum(abs(amount)) filter (where direction = 'out'), 0)::float8 as outflow,
      count(*)::int as count
    from base
    group by period_start, currency
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'period_start', period_start,
        'iso_currency_code', iso_currency_code,
        'inflow', inflow,
        'outflow', outflow,
        'net', inflow - outflow,
        'count', count
      )
      order by period_start desc
    ),
    '[]'::jsonb
  )
  from agg;
$$;

revoke all on function public.treasury_query_summary(uuid, text, date, date, text) from public;
grant execute on function public.treasury_query_summary(uuid, text, date, date, text) to service_role;
grant execute on function public.treasury_query_summary(uuid, text, date, date, text) to authenticated;

-- Monthly outflows for spend-plan (same set-based pattern)
create or replace function public.treasury_monthly_outflows(
  p_client uuid,
  p_account_id text,
  p_from date,
  p_to date,
  p_label text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(month_key, total),
    '{}'::jsonb
  )
  from (
    select
      (date_trunc('month', t.posted_date::timestamp)::date)::text as month_key,
      sum(abs(t.amount))::float8 as total
    from public.treasury_transactions t
    where t.client_user_id = p_client
      and t.is_removed = false
      and t.pending = false
      and t.direction = 'out'
      and t.account_id = p_account_id
      and t.posted_date >= p_from
      and t.posted_date <= p_to
      and (p_label is null or t.label = p_label)
    group by 1
  ) s;
$$;

revoke all on function public.treasury_monthly_outflows(uuid, text, date, date, text) from public;
grant execute on function public.treasury_monthly_outflows(uuid, text, date, date, text) to service_role;
grant execute on function public.treasury_monthly_outflows(uuid, text, date, date, text) to authenticated;

-- Chip / book meta in one scan (ledger status chips + book span)
create or replace function public.treasury_tx_chip_counts(
  p_client uuid,
  p_from date default null,
  p_to date default null,
  p_account_ids text[] default null,
  p_q text default null,
  p_direction text default null,
  p_amount_min numeric default null,
  p_amount_max numeric default null,
  p_amount_exact numeric default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select
      count(*) filter (
        where label is null and has_pending_suggestion = false
      )::int as needs_label,
      count(*) filter (
        where label is null and has_pending_suggestion = true
      )::int as suggested,
      count(*) filter (where label is not null)::int as labeled
    from public.treasury_transactions t
    where t.client_user_id = p_client
      and t.is_removed = false
      and (p_from is null or t.posted_date >= p_from)
      and (p_to is null or t.posted_date <= p_to)
      and (
        p_account_ids is null
        or cardinality(p_account_ids) = 0
        or t.account_id = any (p_account_ids)
      )
      and (p_direction is null or t.direction = p_direction)
      and (
        p_amount_exact is null
        or t.amount = p_amount_exact
        or t.amount = -p_amount_exact
      )
      and (
        p_amount_exact is not null
        or p_amount_min is null
        or p_amount_max is null
        or (
          t.amount between least(abs(p_amount_min), abs(p_amount_max))
                       and greatest(abs(p_amount_min), abs(p_amount_max))
        )
        or (
          t.amount between -greatest(abs(p_amount_min), abs(p_amount_max))
                       and -least(abs(p_amount_min), abs(p_amount_max))
        )
      )
      and (
        p_q is null
        or p_q = ''
        or t.normalized_merchant ilike '%' || replace(replace(replace(p_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' escape '\'
        or t.raw_name ilike '%' || replace(replace(replace(p_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' escape '\'
        or t.merchant_name ilike '%' || replace(replace(replace(p_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' escape '\'
        or t.description ilike '%' || replace(replace(replace(p_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' escape '\'
      )
  ),
  book as (
    select
      count(*)::int as book_count,
      min(posted_date) filter (where posted_date is not null) as book_first,
      max(posted_date) filter (where posted_date is not null) as book_last,
      max(created_at) as book_imported_at,
      count(*) filter (where pending = true)::int as pending_count
    from public.treasury_transactions t
    where t.client_user_id = p_client
      and t.is_removed = false
  )
  select jsonb_build_object(
    'needs_label', (select needs_label from scoped),
    'suggested', (select suggested from scoped),
    'labeled', (select labeled from scoped),
    'pending', (select pending_count from book),
    'book_count', (select book_count from book),
    'book_first', (select book_first from book),
    'book_last', (select book_last from book),
    'book_imported_at', (select book_imported_at from book)
  );
$$;

revoke all on function public.treasury_tx_chip_counts(uuid, date, date, text[], text, text, numeric, numeric, numeric) from public;
grant execute on function public.treasury_tx_chip_counts(uuid, date, date, text[], text, text, numeric, numeric, numeric) to service_role;
grant execute on function public.treasury_tx_chip_counts(uuid, date, date, text[], text, text, numeric, numeric, numeric) to authenticated;
