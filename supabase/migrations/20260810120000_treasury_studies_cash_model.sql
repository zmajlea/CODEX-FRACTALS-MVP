-- Spec 65 Part A: cash_model study type + idempotent primary auto-create

alter table public.treasury_studies
  add column if not exists is_primary boolean not null default false;

alter table public.treasury_studies
  drop constraint if exists treasury_studies_type_check;

alter table public.treasury_studies
  add constraint treasury_studies_type_check
  check (type in ('spend_plan', 'cash_model'));

-- One primary cash_model per client + account scope
create unique index if not exists treasury_studies_primary_cash_model_uniq
  on public.treasury_studies (client_user_id, ((scope->>'accountId')))
  where is_primary = true and type = 'cash_model';

-- Idempotent primary study insert (safe under concurrent visits)
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
begin
  if p_account is null or length(trim(p_account)) = 0 then
    raise exception 'accountId required';
  end if;

  select s.id into v_id
  from public.treasury_studies s
  where s.client_user_id = p_client
    and s.type = 'cash_model'
    and s.is_primary = true
    and s.scope->>'accountId' = p_account
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  v_scope := coalesce(p_scope, jsonb_build_object('accountId', p_account, 'label', null));

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
      p_name,
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
        and s.scope->>'accountId' = p_account
      limit 1;
  end;

  return v_id;
end;
$$;

revoke all on function public.treasury_ensure_primary_cash_model(uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.treasury_ensure_primary_cash_model(uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.treasury_ensure_primary_cash_model(uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to authenticated;
