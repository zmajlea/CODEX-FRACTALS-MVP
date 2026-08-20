-- Spec B6: client-scoped monthly analytics — account filter optional.
-- Same SQL path for single-account and all-accounts (no TS dual implementation).

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
      and (p_account_id is null or t.account_id = p_account_id)
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

comment on function public.treasury_monthly_by_category(uuid, text, date, date, text) is
  'Spec B6: p_account_id null = all client accounts; otherwise filter to that account_id.';

-- Spec B6: allow client-wide primary cash_model when no account is specified.
-- Uses scope key "__all__" (not a treasury_accounts uuid) for uniqueness.
create or replace function public.treasury_ensure_primary_cash_model(
  p_client uuid,
  p_account text,
  p_tenant uuid,
  p_actor uuid,
  p_name text default 'Cash model',
  p_scope jsonb default null,
  p_params jsonb default null,
  p_scenarios jsonb default null,
  p_derived_snapshot jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_scope jsonb;
  v_params jsonb;
  v_scenarios jsonb;
  v_snapshot jsonb;
  v_account text;
begin
  v_account := nullif(trim(coalesce(p_account, '')), '');
  if v_account is null then
    v_account := '__all__';
  end if;

  select s.id into v_id
  from public.treasury_studies s
  where s.client_user_id = p_client
    and s.type = 'cash_model'
    and s.is_primary = true
    and s.scope->>'accountId' = v_account
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  v_scope := coalesce(
    p_scope,
    jsonb_build_object('accountId', v_account, 'label', null)
  );
  if v_scope->>'accountId' is null or length(trim(coalesce(v_scope->>'accountId', ''))) = 0 then
    v_scope := jsonb_set(v_scope, '{accountId}', to_jsonb(v_account));
  end if;

  v_params := coalesce(
    p_params,
    jsonb_build_object(
      'horizon', 13,
      'selectedScenarioId', 'base',
      'bucketMap', '{}'::jsonb,
      'excludedMonths', '[]'::jsonb,
      'driverSpec', '{}'::jsonb
    )
  );

  v_scenarios := coalesce(
    p_scenarios,
    jsonb_build_array(
      jsonb_build_object(
        'id', 'base',
        'name', 'Base',
        'factors', jsonb_build_object(
          'collections', 1,
          'other_income', 1,
          'payroll', 1,
          'opex', 1,
          'debt_service', 1,
          'capex', 1,
          'other_out', 1,
          'uncategorized_in', 1,
          'uncategorized_out', 1
        ),
        'minCashThreshold', 500000,
        'source', 'assumed'
      ),
      jsonb_build_object(
        'id', 'downside',
        'name', 'Downside',
        'factors', jsonb_build_object(
          'collections', 0.90,
          'other_income', 1,
          'payroll', 1.05,
          'opex', 1.08,
          'debt_service', 1,
          'capex', 1,
          'other_out', 1,
          'uncategorized_in', 1,
          'uncategorized_out', 1
        ),
        'minCashThreshold', 500000,
        'source', 'assumed'
      )
    )
  );

  v_snapshot := coalesce(
    p_derived_snapshot,
    jsonb_build_object(
      'bucketBaselines', '{}'::jsonb,
      'coveragePct', 0,
      'bucketMap', '{}'::jsonb,
      'openingBalance', null,
      'asOf', to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
      'historyMonthCount', 0,
      'historyDerived', true
    )
  );

  begin
    insert into public.treasury_studies (
      client_user_id,
      operator_tenant_id,
      created_by,
      name,
      type,
      is_primary,
      scope,
      params,
      scenarios,
      derived_snapshot
    ) values (
      p_client,
      p_tenant,
      p_actor,
      coalesce(nullif(trim(p_name), ''), 'Cash model'),
      'cash_model',
      true,
      v_scope,
      v_params,
      v_scenarios,
      v_snapshot
    )
    returning id into v_id;
  exception
    when unique_violation then
      select s.id into v_id
      from public.treasury_studies s
      where s.client_user_id = p_client
        and s.type = 'cash_model'
        and s.is_primary = true
        and s.scope->>'accountId' = v_account
      limit 1;
  end;

  return v_id;
end;
$$;
