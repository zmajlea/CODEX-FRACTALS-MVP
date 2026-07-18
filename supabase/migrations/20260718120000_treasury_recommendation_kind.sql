-- Spec 40: draft kind — recommendation vs question (two open drafts per operator×client)

alter table public.treasury_recommendations
  add column if not exists kind text not null default 'recommendation'
    check (kind in ('recommendation', 'question'));

create index if not exists treasury_recommendations_operator_draft_kind_idx
  on public.treasury_recommendations (client_user_id, created_by, status, kind)
  where status = 'draft';
