-- Queryable plaintext fields + encrypted explanation for temporal_objects
alter table public.temporal_objects
  add column if not exists parsed_date date,
  add column if not exists category text,
  add column if not exists explanation_ciphertext text,
  add column if not exists lens_id text;

create index if not exists temporal_objects_parsed_date_idx
  on public.temporal_objects (vault_id, parsed_date);

create index if not exists temporal_objects_category_idx
  on public.temporal_objects (vault_id, category);
