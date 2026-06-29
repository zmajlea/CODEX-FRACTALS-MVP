-- Fix: gen_random_bytes unavailable when RPC search_path is public-only (Supabase).
-- Use built-in gen_random_uuid() for invite tokens instead of pgcrypto.

create or replace function public.ff_generate_invite_token()
returns text
language sql
volatile
set search_path = public
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

alter table public.vault_invites
  alter column invite_token drop default;

alter table public.vault_invites
  alter column invite_token set default public.ff_generate_invite_token();

create or replace function public.provision_client_seat(
  p_tenant_id uuid,
  p_client_name text,
  p_client_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tenant public.tenants;
  v_vault public.vaults;
  v_invite public.vault_invites;
  v_token text := public.ff_generate_invite_token();
  v_client_user_id uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_distributor(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'Tenant not found';
  end if;

  if v_tenant.available_credits < 1 then
    raise exception 'Insufficient credits';
  end if;

  if nullif(trim(p_client_name), '') is null then
    raise exception 'Client name is required';
  end if;

  if nullif(trim(p_client_email), '') is null then
    raise exception 'Client email is required';
  end if;

  update public.tenants
  set available_credits = available_credits - 1
  where id = p_tenant_id;

  insert into public.credit_transactions (tenant_id, amount, action, metadata)
  values (
    p_tenant_id,
    -1,
    'seat_provisioned',
    jsonb_build_object('client_email', trim(p_client_email), 'client_name', trim(p_client_name))
  );

  insert into public.vaults (name, created_by, tenant_id, ff_status)
  values (trim(p_client_name), v_user, p_tenant_id, 'unstarted')
  returning * into v_vault;

  insert into public.vault_invites (
    vault_id,
    email,
    role,
    status,
    invited_by,
    invite_token,
    tenant_id
  )
  values (
    v_vault.id,
    lower(trim(p_client_email)),
    'CLIENT',
    'pending',
    v_user,
    v_token,
    p_tenant_id
  )
  returning * into v_invite;

  select u.id into v_client_user_id
  from public.users u
  where lower(u.email) = lower(trim(p_client_email))
  limit 1;

  if v_client_user_id is not null then
    insert into public.user_roles (user_id, role, tenant_id)
    values (v_client_user_id, 'client', p_tenant_id)
    on conflict (user_id, tenant_id) where tenant_id is not null
    do update set role = 'client';
  end if;

  insert into public.credit_transactions (tenant_id, amount, action, metadata)
  values (
    p_tenant_id,
    0,
    'invite_sent',
    jsonb_build_object(
      'vault_id', v_vault.id,
      'invite_id', v_invite.id,
      'invite_token', v_token
    )
  );

  return jsonb_build_object(
    'vault_id', v_vault.id,
    'invite_id', v_invite.id,
    'invite_token', v_token
  );
end;
$$;
