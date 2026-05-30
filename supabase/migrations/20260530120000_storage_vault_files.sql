-- Encrypted file blobs (ciphertext only; client-side E2E)
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault-files', 'vault-files', false, 52428800)
on conflict (id) do nothing;

create or replace function public.storage_vault_id(object_name text)
returns uuid
language sql
stable
as $$
  select nullif(split_part(object_name, '/', 1), '')::uuid;
$$;

-- Members may read/write objects under their vault folder
create policy vault_files_select_member
on storage.objects for select
to authenticated
using (
  bucket_id = 'vault-files'
  and public.is_vault_member(public.storage_vault_id(name))
);

create policy vault_files_insert_member
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'vault-files'
  and public.is_vault_member(public.storage_vault_id(name))
);

create policy vault_files_update_member
on storage.objects for update
to authenticated
using (
  bucket_id = 'vault-files'
  and public.is_vault_member(public.storage_vault_id(name))
);

create policy vault_files_delete_member
on storage.objects for delete
to authenticated
using (
  bucket_id = 'vault-files'
  and public.is_vault_member(public.storage_vault_id(name))
);
