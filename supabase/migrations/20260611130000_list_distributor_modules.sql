-- Reliable module listing for distributor dashboard + purge helper

create or replace function public.list_distributor_modules(p_tenant_id uuid)
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

  if not public.is_distributor(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'slug', m.slug,
          'name', m.name,
          'status', m.status
        )
        order by m.name
      )
      from public.distributor_modules dm
      join public.modules m on m.id = dm.module_id
      where dm.distributor_tenant_id = p_tenant_id
        and dm.allowed = true
        and m.status in ('active', 'beta')
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.list_distributor_modules(uuid) to authenticated;
