-- Spec 55 A2 — collapse rage-click duplicate active rules, then unique index.
-- Keep the oldest active rule per (client, match_merchant, assign_label, match_type);
-- deactivate the rest and clear their unconfirmed suggestions.

do $$
declare
  collapsed int := 0;
begin
  -- Deactivate newer duplicates (keep oldest created_at, then id).
  with ranked as (
    select
      id,
      row_number() over (
        partition by client_user_id, match_merchant, assign_label, match_type
        order by created_at asc, id asc
      ) as rn
    from public.treasury_rules
    where active = true
  ),
  dupes as (
    select id from ranked where rn > 1
  ),
  cleared as (
    update public.treasury_transactions t
    set
      suggestion_status = null,
      suggested_label = null,
      suggested_by_rule_id = null,
      suggestion_explanation = null
    where t.suggestion_status = 'suggested'
      and t.suggested_by_rule_id in (select id from dupes)
    returning t.id
  ),
  deactivated as (
    update public.treasury_rules r
    set active = false
    where r.id in (select id from dupes)
    returning r.id
  )
  select count(*) into collapsed from deactivated;

  raise notice 'treasury_rules_dedup collapse: % duplicate active rule(s) deactivated', collapsed;
end $$;

create unique index if not exists treasury_rules_dedup
  on public.treasury_rules (client_user_id, match_merchant, assign_label, match_type)
  where active = true;
