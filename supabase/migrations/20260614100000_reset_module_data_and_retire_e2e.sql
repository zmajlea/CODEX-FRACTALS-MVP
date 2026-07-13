-- Test data reset + retire BCN client-side E2E; unified to server-side envelope (client_encryption_keys).

do $$
declare
  r record;
begin
  for r in select dek_secret_id from public.client_encryption_keys loop
    perform public.internal_vault_delete_secret(r.dek_secret_id);
  end loop;
end $$;

truncate table public.ff_continuity_sections;
truncate table public.treasury_accounts;
truncate table public.plaid_items cascade;
truncate table public.ff_trusted_advisors;
truncate table public.client_encryption_keys;

update public.vaults
set
  encryption_test = null,
  encryption_test_updated_at = null;
