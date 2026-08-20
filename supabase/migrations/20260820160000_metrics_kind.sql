-- Spec B5: metric kind (value | analytics)
alter table public.treasury_metrics
  add column if not exists kind text not null default 'value';

alter table public.treasury_metrics
  drop constraint if exists treasury_metrics_kind_check;

alter table public.treasury_metrics
  add constraint treasury_metrics_kind_check
  check (kind in ('value', 'analytics'));

comment on column public.treasury_metrics.kind is
  'value = scalar (B3/B4); analytics = chartable series envelope (B5)';
