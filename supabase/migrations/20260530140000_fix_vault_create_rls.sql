-- Fix vault creation: RLS chicken-and-egg + ensure profile exists before FK insert.
-- Run in Supabase SQL Editor after initial schema migration.

-- Creators can read their vault immediately (INSERT … RETURNING)
drop policy if exists vaults_select_own on public.vaults;
create policy vaults_select_own
on public.vaults for select
using (created_by = auth.uid());

-- SECURITY DEFINER RPC: server sets created_by from auth.uid() (client cannot spoof)
create or replace function public.create_vault(p_name text)
returns public.vaults
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_vault public.vaults;
  v_email text;
  v_name text;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Vault name is required';
  end if;

  v_email := coalesce(auth.jwt() ->> 'email', '');
  v_name := coalesce(
    auth.jwt() -> 'user_metadata' ->> 'full_name',
    auth.jwt() -> 'user_metadata' ->> 'name',
    split_part(v_email, '@', 1)
  );

  insert into public.users (id, email, display_name)
  values (v_user, v_email, v_name)
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.users.display_name),
    updated_at = now();

  insert into public.vaults (name, created_by)
  values (trim(p_name), v_user)
  returning * into v_vault;

  return v_vault;
end;
$$;

revoke all on function public.create_vault(text) from public;
grant execute on function public.create_vault(text) to authenticated;
