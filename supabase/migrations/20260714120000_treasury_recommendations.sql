-- Treasury recommendations (operator judgment sealed on send; client accept/decline)

create table if not exists public.treasury_recommendations (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users (id) on delete cascade,
  operator_tenant_id uuid references public.tenants (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  title text not null,
  category text not null check (category in ('liquidity', 'cost', 'financing', 'risk')),
  why text not null,
  impact_amount numeric,
  impact_unit text,
  impact_basis text check (impact_basis in ('per_month', 'per_year', 'one_time')),
  anchor_type text not null default 'general' check (anchor_type in ('account', 'general')),
  anchor_ref jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'in_progress', 'done', 'declined')),
  sealed_at timestamptz,
  sealed_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz,
  decided_at timestamptz,
  decline_reason text,
  decline_note text,
  operator_seen_at timestamptz,
  client_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index treasury_recommendations_client_status_idx
  on public.treasury_recommendations (client_user_id, status);

create index treasury_recommendations_tenant_status_idx
  on public.treasury_recommendations (operator_tenant_id, status)
  where operator_tenant_id is not null;

create trigger treasury_recommendations_set_updated_at
before update on public.treasury_recommendations
for each row execute function public.set_updated_at();

-- Immutable content after seal
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
    then
      raise exception 'Sealed recommendations cannot change content fields';
    end if;
  end if;
  return new;
end;
$$;

create trigger treasury_recommendations_immutable_content_trg
before update on public.treasury_recommendations
for each row execute function public.treasury_recommendations_immutable_content();

alter table public.treasury_recommendations enable row level security;

create policy treasury_recommendations_owner_select on public.treasury_recommendations
for select to authenticated
using (client_user_id = auth.uid() and status <> 'draft');
