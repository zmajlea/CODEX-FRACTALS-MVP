-- Spec B15 — per-block chart|table view mode on review exhibits
alter table public.treasury_review_blocks
  add column if not exists view_mode text not null default 'chart';

alter table public.treasury_review_blocks
  drop constraint if exists treasury_review_blocks_view_mode_check;

alter table public.treasury_review_blocks
  add constraint treasury_review_blocks_view_mode_check
  check (view_mode in ('chart', 'table'));

comment on column public.treasury_review_blocks.view_mode is
  'Operator choice: chart (default) or table; frozen into published snapshot';
