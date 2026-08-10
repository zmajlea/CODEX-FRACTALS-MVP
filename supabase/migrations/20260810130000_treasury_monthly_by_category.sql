-- Spec 65 Commit 2: monthly category series (group-by RPC, no fetch-all)

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
    select
      coalesce(nullif(trim(t.label), ''), '__uncategorized__') as label_key,
      t.direction as direction_key,
      (date_trunc('month', t.posted_date::timestamp)::date)::text as month_key,
      sum(abs(t.amount))::float8 as total
    from public.treasury_transactions t
    where t.client_user_id = p_client
      and t.is_removed = false
      and t.pending = false
      and t.account_id = p_account_id
      and t.posted_date >= p_from
      and t.posted_date <= p_to
      and t.direction in ('in', 'out')
      and (p_direction is null or t.direction = p_direction)
    group by 1, 2, 3
  ) s;
$$;

revoke all on function public.treasury_monthly_by_category(uuid, text, date, date, text) from public;
grant execute on function public.treasury_monthly_by_category(uuid, text, date, date, text) to service_role;
grant execute on function public.treasury_monthly_by_category(uuid, text, date, date, text) to authenticated;
