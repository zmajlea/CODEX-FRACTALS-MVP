-- Ubiquitous language: Financial Firefighter → Business Continuity Navigator (BCN)
-- Distributor → Operator

-- ---------------------------------------------------------------------------
-- 1. Table rename
-- ---------------------------------------------------------------------------
alter table if exists public.distributor_modules rename to operator_modules;

alter policy if exists distributor_modules_select on public.operator_modules
  rename to operator_modules_select;
alter policy if exists distributor_modules_write_global_admin on public.operator_modules
  rename to operator_modules_write_global_admin;

-- ---------------------------------------------------------------------------
-- 2. Commercial role: distributor → operator
-- ---------------------------------------------------------------------------
alter type public.ff_commercial_role rename value 'distributor' to 'operator';

-- ---------------------------------------------------------------------------
-- 3. Module slug: ff → bcn
-- ---------------------------------------------------------------------------
update public.modules
set
  slug = 'bcn',
  route_base = '/bcn',
  name = 'Business Continuity Navigator'
where slug = 'ff';

update public.vault_invites
set module_slug = 'bcn'
where module_slug = 'ff' or module_slug is null;

-- ---------------------------------------------------------------------------
-- 4. Branding preset rename in JSON (ff1–ff4 → bcn1–bcn4)
-- ---------------------------------------------------------------------------
create or replace function public._migrate_branding_presets(p jsonb)
returns jsonb
language sql
immutable
as $$
  select replace(
    replace(
      replace(
        replace(
          replace(
            replace(coalesce(p, '{}'::jsonb)::text, '"ff4"', '"bcn4"'),
            '"ff3"', '"bcn3"'
          ),
          '"ff2"', '"bcn2"'
        ),
        '"ff1"', '"bcn1"'
      ),
      'Financial Firefighter',
      'Business Continuity Navigator'
    ),
    '"ff3"', '"bcn3"'
  )::jsonb;
$$;

update public.tenants
set branding = public._migrate_branding_presets(branding);

update public.operator_modules
set branding = public._migrate_branding_presets(branding);

drop function public._migrate_branding_presets(jsonb);

-- ---------------------------------------------------------------------------
-- 5. RBAC helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_operator(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role::text in ('operator', 'distributor')
      and ur.tenant_id = p_tenant_id
  );
$$;

create or replace function public.is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_operator(p_tenant_id) or public.is_global_admin();
$$;

grant execute on function public.is_operator(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Branding normalization (bcn presets)
-- ---------------------------------------------------------------------------
create or replace function public.normalize_module_branding(p_branding jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_branding jsonb := coalesce(p_branding, '{}'::jsonb);
  v_preset text;
  v_custom jsonb;
  v_base text;
  v_key text;
  v_val text;
  v_allowed text[] := array[
    '--brand', '--brand-2', '--seal', '--foil',
    '--canvas', '--paper', '--ink', '--cinnabar'
  ];
begin
  v_preset := nullif(trim(v_branding ->> 'data-brand'), '');

  if v_preset is not null and v_preset not in (
    'bcn1', 'bcn2', 'bcn3', 'bcn4', 'fractals', 'summit', 'custom'
  ) then
    raise exception 'Invalid data-brand preset: %', v_preset;
  end if;

  if v_branding ? 'custom' then
    v_custom := coalesce(v_branding -> 'custom', '{}'::jsonb);
    v_base := nullif(trim(v_custom ->> 'base'), '');
    if v_base is not null and v_base not in ('bcn1', 'bcn2', 'bcn3') then
      raise exception 'Invalid custom.base preset: %', v_base;
    end if;

    if v_custom ? 'wordmark' then
      v_custom := v_custom || jsonb_build_object(
        'wordmark', left(trim(v_custom ->> 'wordmark'), 120)
      );
    end if;

    if v_custom ? 'logo_url' then
      v_custom := v_custom || jsonb_build_object(
        'logo_url', left(nullif(trim(v_custom ->> 'logo_url'), ''), 2048)
      );
      if v_custom ->> 'logo_url' is null then
        v_custom := v_custom - 'logo_url';
      end if;
    end if;

    foreach v_key in array v_allowed loop
      if v_custom ? v_key then
        v_val := nullif(trim(v_custom ->> v_key), '');
        if v_val is not null then
          if v_val !~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$' then
            raise exception 'Invalid color for custom.%: %', v_key, v_val;
          end if;
          v_custom := v_custom || jsonb_build_object(v_key, lower(v_val));
        else
          v_custom := v_custom - v_key;
        end if;
      end if;
    end loop;

    v_branding := v_branding || jsonb_build_object('custom', v_custom);
  end if;

  if v_preset = 'custom' then
    if v_branding ? 'wordmark' then
      v_branding := v_branding || jsonb_build_object(
        'wordmark', left(trim(v_branding ->> 'wordmark'), 120)
      );
    end if;

    foreach v_key in array v_allowed loop
      if v_branding ? v_key then
        v_val := nullif(trim(v_branding ->> v_key), '');
        if v_val is not null then
          if v_val !~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$' then
            raise exception 'Invalid color for %: %', v_key, v_val;
          end if;
          v_branding := v_branding || jsonb_build_object(v_key, lower(v_val));
        else
          v_branding := v_branding - v_key;
        end if;
      end if;
    end loop;
  else
    v_branding := v_branding - 'wordmark';
    foreach v_key in array v_allowed loop
      v_branding := v_branding - v_key;
    end loop;
  end if;

  return v_branding;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Operator module RPCs (replace distributor_* names)
-- ---------------------------------------------------------------------------
create or replace function public.set_operator_module_branding(
  p_tenant_id uuid,
  p_module_slug text,
  p_branding jsonb default '{}'::jsonb,
  p_logo_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module public.modules;
  v_row public.operator_modules;
  v_branding jsonb;
  v_logo text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_operator(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  select * into v_module
  from public.modules
  where slug = p_module_slug and status in ('active', 'beta');

  if not found then
    raise exception 'Module not found';
  end if;

  if not exists (
    select 1 from public.operator_modules om
    where om.distributor_tenant_id = p_tenant_id
      and om.module_id = v_module.id
      and om.allowed = true
  ) then
    raise exception 'Module not enabled for this firm';
  end if;

  v_branding := public.normalize_module_branding(p_branding);
  v_logo := nullif(trim(coalesce(p_logo_url, v_branding #>> '{custom,logo_url}')), '');

  update public.operator_modules om
  set branding = v_branding, logo_url = v_logo
  where om.distributor_tenant_id = p_tenant_id and om.module_id = v_module.id
  returning * into v_row;

  return jsonb_build_object(
    'module_slug', p_module_slug,
    'branding', v_branding,
    'logo_url', v_logo
  );
end;
$$;

create or replace function public.list_operator_modules(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_operator(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'slug', m.slug,
          'name', m.name,
          'status', m.status,
          'logo_url', om.logo_url,
          'branding', coalesce(om.branding, '{}'::jsonb)
        )
        order by m.name
      )
      from public.operator_modules om
      join public.modules m on m.id = om.module_id
      where om.distributor_tenant_id = p_tenant_id
        and om.allowed = true
        and m.status in ('active', 'beta')
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.get_client_module_branding(p_grant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_grant public.client_module_access;
  v_tenant public.tenants;
  v_om public.operator_modules;
  v_module public.modules;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_grant
  from public.client_module_access
  where id = p_grant_id and client_user_id = v_user and status = 'active';

  if not found then
    raise exception 'Grant not found';
  end if;

  select * into v_module from public.modules where id = v_grant.module_id;
  select * into v_tenant from public.tenants where id = v_grant.distributor_tenant_id;

  select * into v_om
  from public.operator_modules om
  where om.distributor_tenant_id = v_grant.distributor_tenant_id
    and om.module_id = v_grant.module_id
    and om.allowed = true;

  return jsonb_build_object(
    'grant_id', v_grant.id,
    'module_slug', v_module.slug,
    'module_name', v_module.name,
    'tenant_id', v_tenant.id,
    'tenant_name', v_tenant.name,
    'tenant_branding', coalesce(v_tenant.branding, '{}'::jsonb),
    'tenant_logo_url', v_tenant.logo_url,
    'tenant_brand_color_hex', v_tenant.brand_color_hex,
    'module_branding', coalesce(v_om.branding, '{}'::jsonb),
    'module_logo_url', v_om.logo_url
  );
end;
$$;

create or replace function public.list_operator_client_invites(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_operator(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  return coalesce(
    (
      select jsonb_agg(row order by (row ->> 'created_at') desc)
      from (
        select jsonb_build_object(
          'invite_id', vi.id,
          'vault_id', v.id,
          'vault_name', v.name,
          'email', vi.email,
          'module_slug', coalesce(vi.module_slug, 'bcn'),
          'module_name', coalesce(m.name, 'Business Continuity Navigator'),
          'status', vi.status,
          'created_at', vi.created_at,
          'invite_token',
            case when vi.status = 'pending' then vi.invite_token else null end
        ) as row
        from public.vault_invites vi
        join public.vaults v on v.id = vi.vault_id
        left join public.modules m on m.slug = coalesce(vi.module_slug, 'bcn')
        where vi.tenant_id = p_tenant_id and vi.role = 'CLIENT'
      ) invites
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.set_operator_module(
  p_tenant_id uuid,
  p_module_slug text,
  p_allowed boolean
)
returns public.operator_modules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module public.modules;
  v_row public.operator_modules;
begin
  if not public.is_global_admin() then
    raise exception 'Not authorized: global_admin required';
  end if;

  select * into v_module from public.modules where slug = p_module_slug;
  if not found then raise exception 'Module not found'; end if;

  insert into public.operator_modules (distributor_tenant_id, module_id, allowed, granted_by)
  values (p_tenant_id, v_module.id, p_allowed, auth.uid())
  on conflict (distributor_tenant_id, module_id)
  do update set allowed = excluded.allowed, granted_by = excluded.granted_by
  returning * into v_row;

  return v_row;
end;
$$;

-- provision_client_seat: operator_modules + default bcn slug
create or replace function public.provision_client_seat(
  p_tenant_id uuid,
  p_client_name text,
  p_client_email text,
  p_module_slug text default 'bcn'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tenant public.tenants;
  v_module public.modules;
  v_vault public.vaults;
  v_invite public.vault_invites;
  v_grant public.client_module_access;
  v_token text := public.ff_generate_invite_token();
  v_client_user_id uuid;
  v_billing_rule_id uuid;
  v_credit_cost integer := 1;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  if not public.is_operator(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  select * into v_module from public.modules where slug = p_module_slug and status in ('active', 'beta');
  if not found then raise exception 'Module not found'; end if;

  if not exists (
    select 1 from public.operator_modules om
    where om.distributor_tenant_id = p_tenant_id
      and om.module_id = v_module.id and om.allowed = true
  ) and not public.is_global_admin() then
    raise exception 'Operator may not sell this module';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'Tenant not found'; end if;

  v_billing_rule_id := public.resolve_billing_rule_id(v_module.id, p_tenant_id);
  select coalesce((select coalesce(br.credit_cost, 1) from public.billing_rules br where br.id = v_billing_rule_id), 1)
  into v_credit_cost;

  if coalesce(v_tenant.credit_balance, v_tenant.available_credits) < v_credit_cost then
    raise exception 'Insufficient credits';
  end if;

  if nullif(trim(p_client_name), '') is null or nullif(trim(p_client_email), '') is null then
    raise exception 'Client name and email are required';
  end if;

  insert into public.vaults (name, created_by, tenant_id, ff_status)
  values (trim(p_client_name), v_user, p_tenant_id, 'unstarted')
  returning * into v_vault;

  insert into public.vault_invites (vault_id, email, role, status, invited_by, invite_token, tenant_id, module_slug)
  values (v_vault.id, lower(trim(p_client_email)), 'CLIENT', 'pending', v_user, v_token, p_tenant_id, p_module_slug)
  returning * into v_invite;

  select u.id into v_client_user_id from public.users u where lower(u.email) = lower(trim(p_client_email)) limit 1;

  if v_client_user_id is not null then
    insert into public.user_roles (user_id, role, tenant_id, granted_by)
    values (v_client_user_id, 'client', p_tenant_id, v_user)
    on conflict (user_id, tenant_id) where tenant_id is not null
    do update set role = 'client', granted_by = excluded.granted_by;

    insert into public.client_module_access (
      client_user_id, module_id, distributor_tenant_id, vault_id, status, billing_rule_id, granted_by
    )
    values (v_client_user_id, v_module.id, p_tenant_id, v_vault.id, 'active', v_billing_rule_id, v_user)
    on conflict (client_user_id, module_id, distributor_tenant_id)
    do update set vault_id = excluded.vault_id, status = 'active',
      billing_rule_id = excluded.billing_rule_id, granted_by = excluded.granted_by, granted_at = now()
    returning * into v_grant;
  end if;

  insert into public.credit_transactions (tenant_id, amount, action, metadata, delta, reason, ref_grant_id, created_by)
  values (
    p_tenant_id, -v_credit_cost, 'seat_provisioned',
    jsonb_build_object('client_email', trim(p_client_email), 'client_name', trim(p_client_name), 'module_slug', p_module_slug, 'vault_id', v_vault.id),
    -v_credit_cost, 'provision_debit', v_grant.id, v_user
  );

  return jsonb_build_object(
    'vault_id', v_vault.id,
    'invite_id', v_invite.id,
    'invite_token', v_token,
    'grant_id', v_grant.id,
    'module_slug', p_module_slug
  );
end;
$$;

-- Drop legacy distributor RPC names
drop function if exists public.set_distributor_module_branding(uuid, text, jsonb, text);
drop function if exists public.list_distributor_modules(uuid);
drop function if exists public.list_distributor_client_invites(uuid);
drop function if exists public.set_distributor_module(uuid, text, boolean);

grant execute on function public.set_operator_module_branding(uuid, text, jsonb, text) to authenticated;
grant execute on function public.list_operator_modules(uuid) to authenticated;
grant execute on function public.get_client_module_branding(uuid) to authenticated;
grant execute on function public.list_operator_client_invites(uuid) to authenticated;
grant execute on function public.set_operator_module(uuid, text, boolean) to authenticated;
grant execute on function public.provision_client_seat(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RLS policies: is_distributor → is_operator
-- ---------------------------------------------------------------------------
drop policy if exists tenants_update_distributor_credits on public.tenants;
create policy tenants_update_operator_credits on public.tenants for update
using (public.is_operator(id))
with check (public.is_operator(id));

drop policy if exists credit_transactions_select_distributor on public.credit_transactions;
create policy credit_transactions_select_operator on public.credit_transactions for select
using (public.is_operator(tenant_id));

drop policy if exists billing_rules_select_distributor on public.billing_rules;
create policy billing_rules_select_operator on public.billing_rules for select
using (distributor_tenant_id is not null and public.is_operator(distributor_tenant_id));

drop policy if exists operator_modules_select on public.operator_modules;
create policy operator_modules_select on public.operator_modules for select
using (public.is_global_admin() or public.is_operator(distributor_tenant_id));

drop policy if exists client_module_access_insert_distributor on public.client_module_access;
create policy client_module_access_insert_operator on public.client_module_access for insert
with check (public.is_operator(distributor_tenant_id) or public.is_global_admin());

drop policy if exists client_module_access_update_distributor on public.client_module_access;
create policy client_module_access_update_operator on public.client_module_access for update
using (public.is_operator(distributor_tenant_id) or public.is_global_admin())
with check (public.is_operator(distributor_tenant_id) or public.is_global_admin());

drop policy if exists client_module_access_select_own on public.client_module_access;
create policy client_module_access_select_own on public.client_module_access for select
using (
  client_user_id = auth.uid()
  or public.is_global_admin()
  or public.is_operator(distributor_tenant_id)
);

drop function if exists public.is_distributor(uuid);

-- ---------------------------------------------------------------------------
-- 9. Invite RPCs: is_operator + default bcn slug
-- ---------------------------------------------------------------------------
create or replace function public.regenerate_client_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.vault_invites;
  v_module public.modules;
  v_tenant public.tenants;
  v_token text;
  v_billing_rule_id uuid;
  v_credit_cost integer := 1;
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select * into v_invite from public.vault_invites where id = p_invite_id for update;
  if not found then raise exception 'Invite not found'; end if;
  if v_invite.tenant_id is null then raise exception 'Invite has no tenant'; end if;

  if not public.is_operator(v_invite.tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  if v_invite.status = 'accepted' then raise exception 'Invite already accepted'; end if;

  v_token := public.ff_generate_invite_token();

  if v_invite.status = 'pending' then
    update public.vault_invites set invite_token = v_token, updated_at = now() where id = p_invite_id;
    return jsonb_build_object('invite_id', p_invite_id, 'invite_token', v_token, 'status', 'pending', 'charged_credits', 0);
  end if;

  if v_invite.status <> 'revoked' then
    raise exception 'Cannot recreate invite in status %', v_invite.status;
  end if;

  select * into v_module from public.modules
  where slug = coalesce(v_invite.module_slug, 'bcn') and status in ('active', 'beta');
  if not found then raise exception 'Module not found'; end if;

  select * into v_tenant from public.tenants where id = v_invite.tenant_id for update;
  v_billing_rule_id := public.resolve_billing_rule_id(v_module.id, v_invite.tenant_id);
  select coalesce((select coalesce(br.credit_cost, 1) from public.billing_rules br where br.id = v_billing_rule_id), 1)
  into v_credit_cost;

  if coalesce(v_tenant.credit_balance, v_tenant.available_credits) < v_credit_cost then
    raise exception 'Insufficient credits';
  end if;

  update public.vault_invites set status = 'pending', invite_token = v_token, updated_at = now() where id = p_invite_id;
  update public.client_module_access set status = 'active', granted_at = now()
  where vault_id = v_invite.vault_id and distributor_tenant_id = v_invite.tenant_id and module_id = v_module.id;

  insert into public.credit_transactions (tenant_id, amount, action, metadata, delta, reason, created_by)
  values (
    v_invite.tenant_id, -v_credit_cost, 'seat_provisioned',
    jsonb_build_object('client_email', v_invite.email, 'vault_id', v_invite.vault_id,
      'module_slug', coalesce(v_invite.module_slug, 'bcn'), 'invite_id', p_invite_id, 'source', 'invite_reissue'),
    -v_credit_cost, 'provision_debit', v_user
  );

  return jsonb_build_object('invite_id', p_invite_id, 'invite_token', v_token, 'status', 'pending', 'charged_credits', v_credit_cost);
end;
$$;

create or replace function public.revoke_client_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.vault_invites;
  v_refund integer := 1;
begin
  select * into v_invite from public.vault_invites where id = p_invite_id for update;
  if not found then raise exception 'Invite not found'; end if;

  if not public.is_operator(v_invite.tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'Only pending invites can be revoked';
  end if;

  update public.vault_invites set status = 'revoked', updated_at = now() where id = p_invite_id;
  update public.client_module_access set status = 'revoked'
  where vault_id = v_invite.vault_id and distributor_tenant_id = v_invite.tenant_id;

  insert into public.credit_transactions (tenant_id, amount, action, metadata, delta, reason, created_by)
  values (
    v_invite.tenant_id, v_refund, 'invite_revoked_refund',
    jsonb_build_object('invite_id', p_invite_id, 'vault_id', v_invite.vault_id),
    v_refund, 'invite_revoked_refund', auth.uid()
  );

  return jsonb_build_object('invite_id', p_invite_id, 'status', 'revoked', 'refunded_credits', v_refund);
end;
$$;

grant execute on function public.regenerate_client_invite(uuid) to authenticated;
grant execute on function public.revoke_client_invite(uuid) to authenticated;
