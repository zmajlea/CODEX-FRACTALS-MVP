-- Spec 40 §7: client answers to questions

alter table public.treasury_recommendations
  add column if not exists client_response text,
  add column if not exists responded_at timestamptz;

-- Freeze content once sent (questions have no sealed_at; recommendations keep sealed too).
-- Status / client_response / responded_at / seen timestamps remain mutable.
create or replace function public.treasury_recommendations_immutable_content()
returns trigger
language plpgsql
as $$
begin
  if old.sealed_at is not null or old.sent_at is not null then
    if new.title is distinct from old.title
      or new.category is distinct from old.category
      or new.why is distinct from old.why
      or new.impact_amount is distinct from old.impact_amount
      or new.impact_unit is distinct from old.impact_unit
      or new.impact_basis is distinct from old.impact_basis
      or new.anchor_type is distinct from old.anchor_type
      or new.anchor_ref is distinct from old.anchor_ref
      or new.evidence is distinct from old.evidence
      or new.kind is distinct from old.kind
    then
      raise exception 'Sent recommendations and questions cannot change content fields';
    end if;
  end if;
  return new;
end;
$$;
