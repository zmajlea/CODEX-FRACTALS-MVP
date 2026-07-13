-- Clients are vault members but not vault admins; allow encryption test blob via RPC.

create or replace function public.set_vault_encryption_test(
  p_vault_id uuid,
  p_encryption_test text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_vault_member(p_vault_id) then
    raise exception 'Not authorized for this vault';
  end if;

  update public.vaults
  set
    encryption_test = p_encryption_test,
    encryption_test_updated_at = now()
  where id = p_vault_id;
end;
$$;

grant execute on function public.set_vault_encryption_test(uuid, text) to authenticated;
