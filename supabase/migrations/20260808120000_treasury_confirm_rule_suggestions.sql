-- Spec 67 Part A: set-based confirm + statement-level pending-suggestion trigger

-- ── 1. Confirm all (or selected) suggestions for a rule in two set statements ─
create or replace function public.treasury_confirm_rule_suggestions(
  p_client uuid,
  p_rule uuid,
  p_actor uuid,
  p_transaction_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_count int := 0;
begin
  with confirmed as (
    update public.treasury_transactions t
    set
      label = s.suggested_label,
      label_source = 'rule_confirmed',
      labeled_by = p_actor,
      labeled_at = now(),
      suggested_by_rule_id = p_rule,
      suggestion_status = 'confirmed',
      suggested_label = null,
      suggestion_explanation = null,
      has_pending_suggestion = false
    from public.treasury_transaction_suggestions s
    where s.rule_id = p_rule
      and s.client_user_id = p_client
      and t.id = s.transaction_id
      and t.client_user_id = p_client
      and t.is_removed = false
      and t.label is null
      and (
        p_transaction_ids is null
        or t.id = any (p_transaction_ids)
      )
    returning t.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]), coalesce(count(*)::int, 0)
    into v_ids, v_count
  from confirmed;

  if v_count > 0 then
    delete from public.treasury_transaction_suggestions
    where transaction_id = any (v_ids);
  end if;

  return jsonb_build_object(
    'confirmed', v_count,
    'transaction_ids', to_jsonb(v_ids)
  );
end;
$$;

revoke all on function public.treasury_confirm_rule_suggestions(uuid, uuid, uuid, uuid[]) from public;
grant execute on function public.treasury_confirm_rule_suggestions(uuid, uuid, uuid, uuid[]) to service_role;
grant execute on function public.treasury_confirm_rule_suggestions(uuid, uuid, uuid, uuid[]) to authenticated;

-- ── 2. Combo confirm: same set-based pattern (was PL/pgSQL row loop) ─────────
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
  v_ids uuid[];
  v_count int := 0;
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
  targets as (
    select transaction_id from per_tx where combo = v_combo
  ),
  confirmed as (
    update public.treasury_transactions t
    set label = v_label,
        label_source = 'rule_confirmed',
        labeled_by = p_actor,
        labeled_at = v_now,
        suggested_by_rule_id = p_rule,
        suggestion_status = 'confirmed',
        suggested_label = null,
        suggestion_explanation = null,
        has_pending_suggestion = false
    from targets
    where t.id = targets.transaction_id
      and t.client_user_id = p_client
      and t.label is null
    returning t.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]), coalesce(count(*)::int, 0)
    into v_ids, v_count
  from confirmed;

  if v_count > 0 then
    delete from public.treasury_transaction_suggestions
    where transaction_id = any (v_ids);
  end if;

  update public.treasury_rules
  set last_applied_at = v_now
  where id = p_rule;

  return jsonb_build_object('confirmed', v_count);
end;
$$;

-- ── 3. Row-level → statement-level pending-suggestion sync ───────────────────
drop trigger if exists treasury_tx_suggestions_sync_pending
  on public.treasury_transaction_suggestions;

drop function if exists public.treasury_sync_has_pending_suggestion();

create or replace function public.treasury_sync_has_pending_suggestion_from_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.treasury_transactions t
  set has_pending_suggestion = exists (
    select 1 from public.treasury_transaction_suggestions s
    where s.transaction_id = t.id
  )
  where t.id in (select distinct transaction_id from new_rows);
  return null;
end;
$$;

create or replace function public.treasury_sync_has_pending_suggestion_from_old()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.treasury_transactions t
  set has_pending_suggestion = exists (
    select 1 from public.treasury_transaction_suggestions s
    where s.transaction_id = t.id
  )
  where t.id in (select distinct transaction_id from old_rows);
  return null;
end;
$$;

create or replace function public.treasury_sync_has_pending_suggestion_from_upd()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.treasury_transactions t
  set has_pending_suggestion = exists (
    select 1 from public.treasury_transaction_suggestions s
    where s.transaction_id = t.id
  )
  where t.id in (
    select distinct transaction_id from new_rows
    union
    select distinct transaction_id from old_rows
  );
  return null;
end;
$$;

create trigger treasury_tx_suggestions_sync_pending_ins
  after insert on public.treasury_transaction_suggestions
  referencing new table as new_rows
  for each statement
  execute function public.treasury_sync_has_pending_suggestion_from_new();

create trigger treasury_tx_suggestions_sync_pending_del
  after delete on public.treasury_transaction_suggestions
  referencing old table as old_rows
  for each statement
  execute function public.treasury_sync_has_pending_suggestion_from_old();

create trigger treasury_tx_suggestions_sync_pending_upd
  after update on public.treasury_transaction_suggestions
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.treasury_sync_has_pending_suggestion_from_upd();
