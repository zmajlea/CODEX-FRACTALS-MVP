-- Spec B14 — third metric kind: comparison (multi-series series_compare)
alter table public.treasury_metrics
  drop constraint if exists treasury_metrics_kind_check;

alter table public.treasury_metrics
  add constraint treasury_metrics_kind_check
  check (kind in ('value', 'analytics', 'comparison'));

comment on column public.treasury_metrics.kind is
  'value = scalar; analytics = MetricSeries v:2; comparison = MetricComparison v:3';
