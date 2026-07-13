-- plaid_items holds the encrypted Plaid access_token; all access is server-side (service role)
-- after an RBAC guard. Clients never read this table directly (balances come from
-- treasury_accounts, transactions from /api/treasury/accounts). Remove the owner-select
-- policy so access_token_ciphertext is not reachable via PostgREST by `authenticated`.

drop policy if exists plaid_items_owner_select on public.plaid_items;
