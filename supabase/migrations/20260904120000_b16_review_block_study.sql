-- Spec B16 — study blocks on review issues
-- Additive: study_id FK + role check includes 'study'

alter table public.treasury_review_blocks
  add column if not exists study_id uuid
    references public.treasury_studies (id) on delete set null;

create index if not exists treasury_review_blocks_study_id_idx
  on public.treasury_review_blocks (study_id)
  where study_id is not null;

alter table public.treasury_review_blocks
  drop constraint if exists treasury_review_blocks_role_check;

alter table public.treasury_review_blocks
  add constraint treasury_review_blocks_role_check check (
    (role in ('figure', 'exhibit')
      and metric_id is not null
      and recommendation_id is null
      and study_id is null)
    or (role = 'note'
      and metric_id is null
      and recommendation_id is null
      and study_id is null)
    or (role = 'narrative'
      and recommendation_id is not null
      and metric_id is null
      and study_id is null)
    or (role = 'study'
      and study_id is not null
      and metric_id is null
      and recommendation_id is null)
  );
