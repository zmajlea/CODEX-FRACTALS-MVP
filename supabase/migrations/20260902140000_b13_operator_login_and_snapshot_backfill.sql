-- Spec B13 — operator default landing + guarded migrated snapshot backfill only.

-- P2-4: treasury operators land on portfolio, not BCN console
create or replace function public.get_ff_login_route()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_grant record;
  v_dist record;
begin
  if v_user is null then
    return jsonb_build_object('route', '/login');
  end if;

  if public.is_global_admin() then
    return jsonb_build_object('route', '/admin', 'role', 'global_admin');
  end if;

  select ur.tenant_id, t.domain_slug
  into v_dist
  from public.user_roles ur
  join public.tenants t on t.id = ur.tenant_id
  where ur.user_id = v_user
    and ur.role::text in ('operator', 'distributor')
  order by ur.created_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'route', '/operator/treasury',
      'role', 'operator',
      'tenant_id', v_dist.tenant_id,
      'domain_slug', v_dist.domain_slug
    );
  end if;

  select
    cma.id as grant_id,
    m.slug as module_slug,
    m.route_base,
    t.domain_slug,
    cma.distributor_tenant_id
  into v_grant
  from public.client_module_access cma
  join public.modules m on m.id = cma.module_id
  join public.tenants t on t.id = cma.distributor_tenant_id
  where cma.client_user_id = v_user
    and cma.status = 'active'
  order by cma.granted_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'route', '/client' || v_grant.route_base,
      'role', 'client',
      'grant_id', v_grant.grant_id,
      'module_slug', v_grant.module_slug,
      'domain_slug', v_grant.domain_slug,
      'tenant_id', v_grant.distributor_tenant_id
    );
  end if;

  return jsonb_build_object('route', '/login', 'role', 'none');
end;
$$;

-- P1-2: allow snapshot-only rewrite during guarded backfill (migrated reviews only)
create or replace function public.treasury_review_versions_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('treasury.review_backfill', true), '') = '1' then
      if new.snapshot is distinct from old.snapshot
        and new.version is not distinct from old.version
        and new.reviewed_as_of is not distinct from old.reviewed_as_of
        and new.published_at is not distinct from old.published_at
        and new.superseded_at is not distinct from old.superseded_at
      then
        return new;
      end if;
    end if;

    if new.snapshot is distinct from old.snapshot
      or new.version is distinct from old.version
      or new.reviewed_as_of is distinct from old.reviewed_as_of
      or new.published_at is distinct from old.published_at
    then
      raise exception 'Published review versions are immutable';
    end if;
    if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
      raise exception 'superseded_at cannot change after being set';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.backfill_migrated_review_snapshot(
  p_version_id uuid,
  p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  select r.label into v_label
  from public.treasury_review_versions v
  join public.treasury_reviews r on r.id = v.review_id
  where v.id = p_version_id;

  if v_label is null then
    raise exception 'Version not found';
  end if;
  if v_label not like 'migrated:%' then
    raise exception 'Backfill allowed only for migrated review snapshots';
  end if;

  perform set_config('treasury.review_backfill', '1', true);

  update public.treasury_review_versions
  set snapshot = p_snapshot
  where id = p_version_id;

  perform set_config('treasury.review_backfill', '0', true);
end;
$$;

comment on function public.backfill_migrated_review_snapshot(uuid, jsonb) is
  'Spec B13: one-off guarded snapshot rewrite for board→review migration; immutability re-locks after call.';

grant execute on function public.backfill_migrated_review_snapshot(uuid, jsonb) to service_role;
