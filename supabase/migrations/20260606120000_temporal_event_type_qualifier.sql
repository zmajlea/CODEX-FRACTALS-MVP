-- event_type (queryable) + qualifier_ciphertext (E2E) for two-part pulse labels
alter table public.temporal_objects
  add column if not exists event_type text,
  add column if not exists qualifier_ciphertext text;

create index if not exists temporal_objects_event_type_idx
  on public.temporal_objects (vault_id, event_type)
  where verified_at is not null;
