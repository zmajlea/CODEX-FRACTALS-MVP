-- Spec 63 — shared rule payee predicate + payee amount stats.
-- pg_trgm already enabled; add GIN indexes for 4-field fuzzy parity.

-- ── Trigram indexes (fuzzy on all four payee fields) ───────────────────────
create index if not exists treasury_transactions_raw_name_trgm_idx
  on public.treasury_transactions using gin (raw_name gin_trgm_ops);

create index if not exists treasury_transactions_merchant_name_trgm_idx
  on public.treasury_transactions using gin (merchant_name gin_trgm_ops);

create index if not exists treasury_transactions_description_trgm_idx
  on public.treasury_transactions using gin (description gin_trgm_ops);

-- ── Escape (mirrors lib/treasury/tx-predicate escapeIlike for % and _) ─────
-- Comma escaping is PostgREST-only; SQL ILIKE does not need it.
create or replace function public.treasury_escape_ilike(p_q text)
returns text
language sql
immutable
parallel safe
as $$
  select replace(
           replace(
             replace(coalesce(p_q, ''), E'\\', E'\\\\'),
             '%', E'\\%'
           ),
           '_', E'\\_'
         );
$$;

-- ── Single payee-match test (contains / exact / fuzzy @ 0.55) ─────────────
create or replace function public.treasury_rule_payee_hit(
  p_normalized text,
  p_raw text,
  p_merchant text,
  p_description text,
  p_payee text,
  p_match_type text
)
returns boolean
language plpgsql
immutable
parallel safe
as $$
declare
  v_type text := lower(coalesce(nullif(trim(p_match_type), ''), 'contains'));
  v_payee text := coalesce(p_payee, '');
  v_safe text;
  v_pat text;
  v_needle text;
begin
  if length(trim(v_payee)) = 0 then
    return false;
  end if;

  if v_type = 'exact' then
    return upper(trim(coalesce(p_normalized, ''))) = upper(trim(v_payee));
  end if;

  if v_type = 'fuzzy' then
    v_needle := upper(trim(v_payee));
    -- Mirror JS fuzzyHit: substring containment OR trigram similarity ≥ 0.55
    return
      upper(coalesce(p_normalized, '')) like '%' || v_needle || '%'
      or upper(coalesce(p_raw, '')) like '%' || v_needle || '%'
      or upper(coalesce(p_merchant, '')) like '%' || v_needle || '%'
      or upper(coalesce(p_description, '')) like '%' || v_needle || '%'
      or greatest(
        similarity(upper(coalesce(p_normalized, '')), v_needle),
        similarity(upper(coalesce(p_raw, '')), v_needle),
        similarity(upper(coalesce(p_merchant, '')), v_needle),
        similarity(upper(coalesce(p_description, '')), v_needle)
      ) >= 0.55;
  end if;

  -- contains (default)
  v_safe := public.treasury_escape_ilike(v_payee);
  v_pat := '%' || v_safe || '%';
  return
    coalesce(p_normalized, '') ilike v_pat escape E'\\'
    or coalesce(p_raw, '') ilike v_pat escape E'\\'
    or coalesce(p_merchant, '') ilike v_pat escape E'\\'
    or coalesce(p_description, '') ilike v_pat escape E'\\';
end;
$$;

-- ── Count matching txs (shared predicate) ─────────────────────────────────
create or replace function public.treasury_rule_match_count(
  p_client uuid,
  p_payee_query text,
  p_match_type text default 'contains',
  p_direction text default null,
  p_amount_min numeric default null,
  p_amount_max numeric default null,
  p_label_null_only boolean default false,
  p_exclude_rejected_for_rule uuid default null
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.treasury_transactions t
  where t.client_user_id = p_client
    and t.is_removed = false
    and t.pending = false
    and public.treasury_rule_payee_hit(
          t.normalized_merchant, t.raw_name, t.merchant_name, t.description,
          p_payee_query, p_match_type
        )
    and (p_direction is null or p_direction not in ('in', 'out') or t.direction = p_direction)
    and (p_amount_min is null or abs(t.amount) >= p_amount_min)
    and (p_amount_max is null or abs(t.amount) <= p_amount_max)
    and (not p_label_null_only or t.label is null)
    and (
      p_exclude_rejected_for_rule is null
      or not exists (
        select 1 from public.treasury_rule_rejections r
        where r.rule_id = p_exclude_rejected_for_rule
          and r.transaction_id = t.id
      )
    );
$$;

revoke all on function public.treasury_rule_match_count(
  uuid, text, text, text, numeric, numeric, boolean, uuid
) from public;
grant execute on function public.treasury_rule_match_count(
  uuid, text, text, text, numeric, numeric, boolean, uuid
) to service_role;
grant execute on function public.treasury_rule_match_count(
  uuid, text, text, text, numeric, numeric, boolean, uuid
) to authenticated;

-- ── Page of matching txs (apply / samples — no id-array blowup) ───────────
create or replace function public.treasury_rule_match_page(
  p_client uuid,
  p_payee_query text,
  p_match_type text default 'contains',
  p_direction text default null,
  p_amount_min numeric default null,
  p_amount_max numeric default null,
  p_label_null_only boolean default false,
  p_exclude_rejected_for_rule uuid default null,
  p_offset int default 0,
  p_limit int default 200
)
returns setof public.treasury_transactions
language sql
stable
security definer
set search_path = public
as $$
  select t.*
  from public.treasury_transactions t
  where t.client_user_id = p_client
    and t.is_removed = false
    and t.pending = false
    and public.treasury_rule_payee_hit(
          t.normalized_merchant, t.raw_name, t.merchant_name, t.description,
          p_payee_query, p_match_type
        )
    and (p_direction is null or p_direction not in ('in', 'out') or t.direction = p_direction)
    and (p_amount_min is null or abs(t.amount) >= p_amount_min)
    and (p_amount_max is null or abs(t.amount) <= p_amount_max)
    and (not p_label_null_only or t.label is null)
    and (
      p_exclude_rejected_for_rule is null
      or not exists (
        select 1 from public.treasury_rule_rejections r
        where r.rule_id = p_exclude_rejected_for_rule
          and r.transaction_id = t.id
      )
    )
  order by t.id asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

revoke all on function public.treasury_rule_match_page(
  uuid, text, text, text, numeric, numeric, boolean, uuid, int, int
) from public;
grant execute on function public.treasury_rule_match_page(
  uuid, text, text, text, numeric, numeric, boolean, uuid, int, int
) to service_role;
grant execute on function public.treasury_rule_match_page(
  uuid, text, text, text, numeric, numeric, boolean, uuid, int, int
) to authenticated;

-- ── Amount distribution stats (active periods only for points_per_period) ──
create or replace function public.treasury_rule_payee_stats(
  p_client uuid,
  p_payee_query text,
  p_direction text default null,
  p_match_type text default 'contains'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total int;
  v_will int;
  v_min numeric;
  v_max numeric;
  v_mean numeric;
  v_stddev numeric;
  v_median numeric;
  v_p25 numeric;
  v_p75 numeric;
  v_by_month jsonb;
  v_by_week jsonb;
  v_avg_month numeric;
  v_avg_week numeric;
begin
  with matched as (
    select
      t.id,
      t.label,
      abs(t.amount) as mag,
      t.posted_date
    from public.treasury_transactions t
    where t.client_user_id = p_client
      and t.is_removed = false
      and t.pending = false
      and public.treasury_rule_payee_hit(
            t.normalized_merchant, t.raw_name, t.merchant_name, t.description,
            p_payee_query, p_match_type
          )
      and (p_direction is null or p_direction not in ('in', 'out') or t.direction = p_direction)
  )
  select
    count(*)::int,
    count(*) filter (where label is null)::int,
    min(mag),
    max(mag),
    avg(mag),
    coalesce(stddev_samp(mag), 0),
    percentile_cont(0.5) within group (order by mag),
    percentile_cont(0.25) within group (order by mag),
    percentile_cont(0.75) within group (order by mag)
  into v_total, v_will, v_min, v_max, v_mean, v_stddev, v_median, v_p25, v_p75
  from matched;

  if v_total is null or v_total = 0 then
    return jsonb_build_object(
      'total', 0,
      'will_suggest', 0,
      'min', null,
      'max', null,
      'mean', null,
      'stddev', null,
      'median', null,
      'p25', null,
      'p75', null,
      'by_month', '[]'::jsonb,
      'by_week', '[]'::jsonb,
      'points_per_period', jsonb_build_object(
        'basis', 'active',
        'avg_per_active_month', null,
        'avg_per_active_week', null
      )
    );
  end if;

  with matched as (
    select
      abs(t.amount) as mag,
      t.posted_date
    from public.treasury_transactions t
    where t.client_user_id = p_client
      and t.is_removed = false
      and t.pending = false
      and public.treasury_rule_payee_hit(
            t.normalized_merchant, t.raw_name, t.merchant_name, t.description,
            p_payee_query, p_match_type
          )
      and (p_direction is null or p_direction not in ('in', 'out') or t.direction = p_direction)
      and t.posted_date is not null
  ),
  by_m as (
    select
      to_char(date_trunc('month', posted_date), 'YYYY-MM') as period,
      count(*)::int as count,
      min(mag) as min,
      max(mag) as max,
      avg(mag) as mean,
      coalesce(stddev_samp(mag), 0) as stddev
    from matched
    group by 1
    order by 1
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'period', period,
             'count', count,
             'min', min,
             'max', max,
             'mean', mean,
             'stddev', stddev
           ) order by period
         ), '[]'::jsonb),
         avg(count)
    into v_by_month, v_avg_month
  from by_m;

  with matched as (
    select
      abs(t.amount) as mag,
      t.posted_date
    from public.treasury_transactions t
    where t.client_user_id = p_client
      and t.is_removed = false
      and t.pending = false
      and public.treasury_rule_payee_hit(
            t.normalized_merchant, t.raw_name, t.merchant_name, t.description,
            p_payee_query, p_match_type
          )
      and (p_direction is null or p_direction not in ('in', 'out') or t.direction = p_direction)
      and t.posted_date is not null
  ),
  by_w as (
    select
      to_char(date_trunc('week', posted_date), 'IYYY-"W"IW') as period,
      count(*)::int as count,
      min(mag) as min,
      max(mag) as max,
      avg(mag) as mean,
      coalesce(stddev_samp(mag), 0) as stddev
    from matched
    group by 1
    order by 1
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'period', period,
             'count', count,
             'min', min,
             'max', max,
             'mean', mean,
             'stddev', stddev
           ) order by period
         ), '[]'::jsonb),
         avg(count)
    into v_by_week, v_avg_week
  from by_w;

  return jsonb_build_object(
    'total', v_total,
    'will_suggest', coalesce(v_will, 0),
    'min', v_min,
    'max', v_max,
    'mean', v_mean,
    'stddev', v_stddev,
    'median', v_median,
    'p25', v_p25,
    'p75', v_p75,
    'by_month', coalesce(v_by_month, '[]'::jsonb),
    'by_week', coalesce(v_by_week, '[]'::jsonb),
    'points_per_period', jsonb_build_object(
      'basis', 'active',
      'avg_per_active_month', v_avg_month,
      'avg_per_active_week', v_avg_week
    )
  );
end;
$$;

revoke all on function public.treasury_rule_payee_stats(uuid, text, text, text) from public;
grant execute on function public.treasury_rule_payee_stats(uuid, text, text, text) to service_role;
grant execute on function public.treasury_rule_payee_stats(uuid, text, text, text) to authenticated;
