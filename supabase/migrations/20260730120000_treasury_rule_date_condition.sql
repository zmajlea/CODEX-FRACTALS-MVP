-- Spec 63 Part F — permanent date_from/date_to on rules + shared predicate.
-- Do NOT edit 20260730100000 — already applied on prod.
-- DROP old signatures then CREATE (defaulted params → new overload otherwise).

alter table public.treasury_rules
  add column if not exists date_from date,
  add column if not exists date_to date;

-- ── DROP old match/stats signatures ───────────────────────────────────────
drop function if exists public.treasury_rule_match_count(
  uuid, text, text, text, numeric, numeric, boolean, uuid
);
drop function if exists public.treasury_rule_match_page(
  uuid, text, text, text, numeric, numeric, boolean, uuid, int, int
);
drop function if exists public.treasury_rule_payee_stats(uuid, text, text, text);

-- ── Count ───────────────────────────────────────────────────────────────
create function public.treasury_rule_match_count(
  p_client uuid,
  p_payee_query text,
  p_match_type text default 'contains',
  p_direction text default null,
  p_amount_min numeric default null,
  p_amount_max numeric default null,
  p_label_null_only boolean default false,
  p_exclude_rejected_for_rule uuid default null,
  p_date_from date default null,
  p_date_to date default null
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
    and not (
      p_date_from is not null and p_date_to is not null and p_date_from > p_date_to
    )
    and (p_date_from is null or (t.posted_date is not null and t.posted_date >= p_date_from))
    and (p_date_to is null or (t.posted_date is not null and t.posted_date <= p_date_to))
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
  uuid, text, text, text, numeric, numeric, boolean, uuid, date, date
) from public;
grant execute on function public.treasury_rule_match_count(
  uuid, text, text, text, numeric, numeric, boolean, uuid, date, date
) to service_role;
grant execute on function public.treasury_rule_match_count(
  uuid, text, text, text, numeric, numeric, boolean, uuid, date, date
) to authenticated;

-- ── Page ──────────────────────────────────────────────────────────────
create function public.treasury_rule_match_page(
  p_client uuid,
  p_payee_query text,
  p_match_type text default 'contains',
  p_direction text default null,
  p_amount_min numeric default null,
  p_amount_max numeric default null,
  p_label_null_only boolean default false,
  p_exclude_rejected_for_rule uuid default null,
  p_offset int default 0,
  p_limit int default 200,
  p_date_from date default null,
  p_date_to date default null
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
    and not (
      p_date_from is not null and p_date_to is not null and p_date_from > p_date_to
    )
    and (p_date_from is null or (t.posted_date is not null and t.posted_date >= p_date_from))
    and (p_date_to is null or (t.posted_date is not null and t.posted_date <= p_date_to))
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
  uuid, text, text, text, numeric, numeric, boolean, uuid, int, int, date, date
) from public;
grant execute on function public.treasury_rule_match_page(
  uuid, text, text, text, numeric, numeric, boolean, uuid, int, int, date, date
) to service_role;
grant execute on function public.treasury_rule_match_page(
  uuid, text, text, text, numeric, numeric, boolean, uuid, int, int, date, date
) to authenticated;

-- ── Stats (optional band + date for Review) ───────────────────────────────
create function public.treasury_rule_payee_stats(
  p_client uuid,
  p_payee_query text,
  p_direction text default null,
  p_match_type text default 'contains',
  p_amount_min numeric default null,
  p_amount_max numeric default null,
  p_date_from date default null,
  p_date_to date default null
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
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    return jsonb_build_object(
      'total', 0,
      'will_suggest', 0,
      'min', null, 'max', null, 'mean', null, 'stddev', null,
      'median', null, 'p25', null, 'p75', null,
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
      and (p_amount_min is null or abs(t.amount) >= p_amount_min)
      and (p_amount_max is null or abs(t.amount) <= p_amount_max)
      and (p_date_from is null or (t.posted_date is not null and t.posted_date >= p_date_from))
      and (p_date_to is null or (t.posted_date is not null and t.posted_date <= p_date_to))
  )
  select
    count(*)::int,
    count(*) filter (where label is null)::int,
    min(mag), max(mag), avg(mag), coalesce(stddev_samp(mag), 0),
    percentile_cont(0.5) within group (order by mag),
    percentile_cont(0.25) within group (order by mag),
    percentile_cont(0.75) within group (order by mag)
  into v_total, v_will, v_min, v_max, v_mean, v_stddev, v_median, v_p25, v_p75
  from matched;

  if v_total is null or v_total = 0 then
    return jsonb_build_object(
      'total', 0,
      'will_suggest', 0,
      'min', null, 'max', null, 'mean', null, 'stddev', null,
      'median', null, 'p25', null, 'p75', null,
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
    select abs(t.amount) as mag, t.posted_date
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
      and (p_date_from is null or (t.posted_date is not null and t.posted_date >= p_date_from))
      and (p_date_to is null or (t.posted_date is not null and t.posted_date <= p_date_to))
      and t.posted_date is not null
  ),
  by_m as (
    select
      to_char(date_trunc('month', posted_date), 'YYYY-MM') as period,
      count(*)::int as count,
      min(mag) as min, max(mag) as max, avg(mag) as mean,
      coalesce(stddev_samp(mag), 0) as stddev
    from matched
    group by 1
    order by 1
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'period', period, 'count', count,
             'min', min, 'max', max, 'mean', mean, 'stddev', stddev
           ) order by period
         ), '[]'::jsonb),
         avg(count)
    into v_by_month, v_avg_month
  from by_m;

  with matched as (
    select abs(t.amount) as mag, t.posted_date
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
      and (p_date_from is null or (t.posted_date is not null and t.posted_date >= p_date_from))
      and (p_date_to is null or (t.posted_date is not null and t.posted_date <= p_date_to))
      and t.posted_date is not null
  ),
  by_w as (
    select
      to_char(date_trunc('week', posted_date), 'IYYY-"W"IW') as period,
      count(*)::int as count,
      min(mag) as min, max(mag) as max, avg(mag) as mean,
      coalesce(stddev_samp(mag), 0) as stddev
    from matched
    group by 1
    order by 1
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'period', period, 'count', count,
             'min', min, 'max', max, 'mean', mean, 'stddev', stddev
           ) order by period
         ), '[]'::jsonb),
         avg(count)
    into v_by_week, v_avg_week
  from by_w;

  return jsonb_build_object(
    'total', v_total,
    'will_suggest', coalesce(v_will, 0),
    'min', v_min, 'max', v_max, 'mean', v_mean, 'stddev', v_stddev,
    'median', v_median, 'p25', v_p25, 'p75', v_p75,
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

revoke all on function public.treasury_rule_payee_stats(
  uuid, text, text, text, numeric, numeric, date, date
) from public;
grant execute on function public.treasury_rule_payee_stats(
  uuid, text, text, text, numeric, numeric, date, date
) to service_role;
grant execute on function public.treasury_rule_payee_stats(
  uuid, text, text, text, numeric, numeric, date, date
) to authenticated;
