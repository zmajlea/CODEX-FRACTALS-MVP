-- Spec 61 — rule queue triage facets (combo buckets + server-side filter/confirm).
-- No full-book id arrays (Spec 60 lesson).

-- ── 1. Facet aggregation ───────────────────────────────────────────────────
create or replace function public.treasury_rule_queue_facets(
  p_client uuid,
  p_rule uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_combos jsonb;
  v_confirmed int;
  v_rejected int;
begin
  select coalesce(jsonb_agg(
           jsonb_build_object('labels', combo, 'count', n)
           order by n desc
         ), '[]'::jsonb)
    into v_combos
  from (
    select combo, count(*)::int as n
    from (
      select s.transaction_id,
             array_agg(distinct all_s.suggested_label order by all_s.suggested_label) as combo
      from public.treasury_transaction_suggestions s
      join public.treasury_transactions t
        on t.id = s.transaction_id
       and t.label is null
       and t.is_removed = false
      join public.treasury_transaction_suggestions all_s
        on all_s.transaction_id = s.transaction_id
      where s.client_user_id = p_client
        and s.rule_id = p_rule
      group by s.transaction_id
    ) per_tx
    group by combo
  ) grouped;

  select count(*)::int into v_confirmed
  from public.treasury_transactions t
  where t.client_user_id = p_client
    and t.is_removed = false
    and t.label_source = 'rule_confirmed'
    and t.suggested_by_rule_id = p_rule;

  select count(*)::int into v_rejected
  from public.treasury_rule_rejections r
  where r.rule_id = p_rule;

  return jsonb_build_object(
    'combos', v_combos,
    'confirmed', coalesce(v_confirmed, 0),
    'rejected', coalesce(v_rejected, 0)
  );
end;
$$;

revoke all on function public.treasury_rule_queue_facets(uuid, uuid) from public;
grant execute on function public.treasury_rule_queue_facets(uuid, uuid) to service_role;
grant execute on function public.treasury_rule_queue_facets(uuid, uuid) to authenticated;

-- ── 2. Combo page — one page of ids only (never the full bucket) ───────────
create or replace function public.treasury_rule_queue_combo_page(
  p_client uuid,
  p_rule uuid,
  p_combo text[],
  p_offset int default 0,
  p_limit int default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_combo text[];
  v_total int;
  v_ids uuid[];
begin
  if p_combo is null or cardinality(p_combo) = 0 then
    return jsonb_build_object('total', 0, 'ids', '[]'::jsonb);
  end if;

  select array_agg(x order by x) into v_combo from unnest(p_combo) as x;

  with per_tx as (
    select s.transaction_id,
           array_agg(distinct all_s.suggested_label order by all_s.suggested_label) as combo
    from public.treasury_transaction_suggestions s
    join public.treasury_transactions t
      on t.id = s.transaction_id
     and t.label is null
     and t.is_removed = false
    join public.treasury_transaction_suggestions all_s
      on all_s.transaction_id = s.transaction_id
    where s.client_user_id = p_client
      and s.rule_id = p_rule
    group by s.transaction_id
  ),
  matched as (
    select transaction_id from per_tx where combo = v_combo
  )
  select count(*)::int into v_total from matched;

  with per_tx as (
    select s.transaction_id,
           array_agg(distinct all_s.suggested_label order by all_s.suggested_label) as combo
    from public.treasury_transaction_suggestions s
    join public.treasury_transactions t
      on t.id = s.transaction_id
     and t.label is null
     and t.is_removed = false
    join public.treasury_transaction_suggestions all_s
      on all_s.transaction_id = s.transaction_id
    where s.client_user_id = p_client
      and s.rule_id = p_rule
    group by s.transaction_id
  ),
  matched as (
    select transaction_id from per_tx where combo = v_combo
  ),
  ordered as (
    select m.transaction_id
    from matched m
    join public.treasury_transactions t on t.id = m.transaction_id
    order by t.posted_date desc nulls last, t.id desc
    offset greatest(p_offset, 0)
    limit least(greatest(p_limit, 1), 200)
  )
  select coalesce(array_agg(transaction_id), '{}'::uuid[]) into v_ids from ordered;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'ids', to_jsonb(coalesce(v_ids, '{}'::uuid[]))
  );
end;
$$;

revoke all on function public.treasury_rule_queue_combo_page(uuid, uuid, text[], int, int) from public;
grant execute on function public.treasury_rule_queue_combo_page(uuid, uuid, text[], int, int) to service_role;
grant execute on function public.treasury_rule_queue_combo_page(uuid, uuid, text[], int, int) to authenticated;

-- ── 3. Confirm entire combo bucket server-side ─────────────────────────────
create or replace function public.treasury_rule_queue_combo_confirm(
  p_client uuid,
  p_rule uuid,
  p_combo text[],
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_combo text[];
  v_label text;
  v_count int := 0;
  v_tx uuid;
  v_now timestamptz := now();
begin
  if p_combo is null or cardinality(p_combo) = 0 then
    return jsonb_build_object('confirmed', 0);
  end if;

  select assign_label into v_label
  from public.treasury_rules
  where id = p_rule and client_user_id = p_client;
  if v_label is null then
    raise exception 'Rule not found';
  end if;

  select array_agg(x order by x) into v_combo from unnest(p_combo) as x;

  for v_tx in
    with per_tx as (
      select s.transaction_id,
             array_agg(distinct all_s.suggested_label order by all_s.suggested_label) as combo
      from public.treasury_transaction_suggestions s
      join public.treasury_transactions t
        on t.id = s.transaction_id
       and t.label is null
       and t.is_removed = false
      join public.treasury_transaction_suggestions all_s
        on all_s.transaction_id = s.transaction_id
      where s.client_user_id = p_client
        and s.rule_id = p_rule
      group by s.transaction_id
    )
    select transaction_id from per_tx where combo = v_combo
  loop
    update public.treasury_transactions
    set label = v_label,
        label_source = 'rule_confirmed',
        labeled_by = p_actor,
        labeled_at = v_now,
        suggested_by_rule_id = p_rule,
        suggestion_status = 'confirmed',
        suggested_label = null,
        suggestion_explanation = null
    where id = v_tx
      and client_user_id = p_client
      and label is null;

    if found then
      delete from public.treasury_transaction_suggestions
      where transaction_id = v_tx;
      v_count := v_count + 1;
    end if;
  end loop;

  update public.treasury_rules
  set last_applied_at = v_now
  where id = p_rule;

  return jsonb_build_object('confirmed', v_count);
end;
$$;

revoke all on function public.treasury_rule_queue_combo_confirm(uuid, uuid, text[], uuid) from public;
grant execute on function public.treasury_rule_queue_combo_confirm(uuid, uuid, text[], uuid) to service_role;
grant execute on function public.treasury_rule_queue_combo_confirm(uuid, uuid, text[], uuid) to authenticated;
