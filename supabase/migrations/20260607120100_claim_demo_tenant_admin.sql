-- Dev convenience: first authenticated user can claim demo tenant admin if unassigned.

create or replace function public.claim_demo_tenant_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tenant_id uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_tenant_id from public.tenants where subdomain = 'demo' limit 1;
  if v_tenant_id is null then
    return false;
  end if;

  if exists (select 1 from public.tenant_members where tenant_id = v_tenant_id) then
    return public.is_tenant_admin(v_tenant_id);
  end if;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_tenant_id, v_user, 'ADMIN');

  return true;
end;
$$;
