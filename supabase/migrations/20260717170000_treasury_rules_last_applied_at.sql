-- Spec 34: disambiguate matched 0 vs never applied
alter table public.treasury_rules
  add column if not exists last_applied_at timestamptz;
