-- Spec 39: evidence list on recommendations (basket = open draft)

alter table public.treasury_recommendations
  add column if not exists evidence jsonb not null default '[]'::jsonb;

-- Sealed immutability is a database guarantee — include evidence
create or replace function public.treasury_recommendations_immutable_content()
returns trigger
language plpgsql
as $$
begin
  if old.sealed_at is not null then
    if new.title is distinct from old.title
      or new.category is distinct from old.category
      or new.why is distinct from old.why
      or new.impact_amount is distinct from old.impact_amount
      or new.impact_unit is distinct from old.impact_unit
      or new.impact_basis is distinct from old.impact_basis
      or new.anchor_type is distinct from old.anchor_type
      or new.anchor_ref is distinct from old.anchor_ref
      or new.evidence is distinct from old.evidence
    then
      raise exception 'Sealed recommendations cannot change content fields';
    end if;
  end if;
  return new;
end;
$$;
