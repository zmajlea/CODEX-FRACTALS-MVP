-- Source dedup metadata on plaid_items (non-unique — same bank, two logins allowed via force)
alter table public.plaid_items
  add column if not exists institution_id text;

alter table public.plaid_items
  add column if not exists status text not null default 'active'
  check (status in ('active', 'needs_reconnect', 'removed'));

create index if not exists plaid_items_client_institution_idx
  on public.plaid_items (client_user_id, institution_id);
