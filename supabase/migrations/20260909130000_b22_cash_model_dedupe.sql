-- B22: one primary per (client, type); dedupe dual cash_model primaries; fix ensure RPC.
-- Order: dedupe → repoint blocks → delete/demote losers → swap index → replace RPC.

-- 1) Pick winners among is_primary cash_model rows (prefer __all__, else newest).
create temporary table _b22_primary_rank on commit drop as
select
  s.id,
  s.client_user_id,
  row_number() over (
    partition by s.client_user_id
    order by
      case when coalesce(s.scope->>'accountId', '') = '__all__' then 0 else 1 end,
      s.updated_at desc nulls last,
      s.created_at desc nulls last,
      s.id
  ) as rn
from public.treasury_studies s
where s.type = 'cash_model'
  and s.is_primary = true;

-- 2) Repoint review blocks from losers → winner for same client.
update public.treasury_review_blocks b
set study_id = w.id
from _b22_primary_rank l
join _b22_primary_rank w
  on w.client_user_id = l.client_user_id
 and w.rn = 1
where l.rn > 1
  and b.study_id = l.id;

-- 3) Delete losers that are no longer referenced; demote any still referenced.
delete from public.treasury_studies s
where s.id in (select id from _b22_primary_rank where rn > 1)
  and not exists (
    select 1 from public.treasury_review_blocks b where b.study_id = s.id
  );

update public.treasury_studies s
set is_primary = false
where s.id in (select id from _b22_primary_rank where rn > 1);

-- 4) Swap unique index: was (client, accountId) for cash_model only.
drop index if exists public.treasury_studies_primary_cash_model_uniq;

create unique index if not exists treasury_studies_one_primary_per_kind
  on public.treasury_studies (client_user_id, type)
  where is_primary = true;

-- 5) Ensure RPC: existence by (client, type); demote before insert; no per-account primary spawn.
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

  -- One primary per (client, type) — reuse if any primary cash_model exists.
  select s.id into v_id
  from public.treasury_studies s
  where s.client_user_id = p_client
    and s.type = 'cash_model'
    and s.is_primary = true
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

  -- Belt-and-suspenders: clear any stray primaries before insert.
  update public.treasury_studies
  set is_primary = false
  where client_user_id = p_client
    and type = 'cash_model'
    and is_primary = true;

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
      limit 1;
  end;

  return v_id;
end;
$$;
