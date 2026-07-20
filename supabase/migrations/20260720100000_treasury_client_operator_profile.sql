-- Spec 46 Stage 2d — per-client operator portfolio notes

create table if not exists public.treasury_client_operator_profile (
  distributor_tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  industry text,
  next_note text,
  watch_note text,
  /** Short banner / .clcard.attn label when the record needs operator attention. */
  attention_reason text,
  updated_at timestamptz not null default now(),
  primary key (distributor_tenant_id, client_user_id)
);

alter table public.treasury_client_operator_profile enable row level security;

create policy treasury_client_operator_profile_operator_select
  on public.treasury_client_operator_profile
  for select
  to authenticated
  using (public.is_operator(distributor_tenant_id) or public.is_global_admin());

create policy treasury_client_operator_profile_operator_write
  on public.treasury_client_operator_profile
  for all
  to authenticated
  using (public.is_operator(distributor_tenant_id) or public.is_global_admin())
  with check (public.is_operator(distributor_tenant_id) or public.is_global_admin());

-- Extend portfolio RPC (notes + uncategorized count)
create or replace function public.list_operator_treasury_clients(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_treasury_module_id uuid;
begin
  if not public.is_operator(p_tenant_id) and not public.is_global_admin() then
    raise exception 'Not authorized for this tenant';
  end if;

  select id into v_treasury_module_id
  from public.modules
  where slug = 'treasury'
  limit 1;

  if v_treasury_module_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(row order by (row ->> 'client_name') asc nulls last)
      from (
        select jsonb_build_object(
          'grant_id', cma.id,
          'client_user_id', cma.client_user_id,
          'client_email', u.email,
          'client_name', coalesce(
            nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
            nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
            split_part(u.email, '@', 1)
          ),
          'status', cma.status,
          'institution_count', (
            select count(*)::int
            from public.plaid_items pi
            where pi.client_user_id = cma.client_user_id
          ),
          'account_count', (
            select count(*)::int
            from public.treasury_accounts ta
            where ta.client_user_id = cma.client_user_id
          ),
          'total_cash', coalesce((
            select sum(ta.current_balance)
            from public.treasury_accounts ta
            where ta.client_user_id = cma.client_user_id
          ), 0),
          'total_cash_by_currency', coalesce((
            select jsonb_object_agg(currency, total)
            from (
              select
                coalesce(ta.iso_currency_code, 'USD') as currency,
                sum(ta.current_balance) as total
              from public.treasury_accounts ta
              where ta.client_user_id = cma.client_user_id
              group by coalesce(ta.iso_currency_code, 'USD')
            ) sums
          ), '{}'::jsonb),
          'last_synced_at', (
            select max(ta.updated_at)
            from public.treasury_accounts ta
            where ta.client_user_id = cma.client_user_id
          ),
          'needs_label_count', (
            select count(*)::int
            from public.treasury_transactions tt
            where tt.client_user_id = cma.client_user_id
              and tt.is_removed = false
              and tt.label is null
              and (tt.suggestion_status is null or tt.suggestion_status <> 'suggested')
          ),
          'industry', prof.industry,
          'next_note', prof.next_note,
          'watch_note', prof.watch_note,
          'attention_reason', prof.attention_reason
        ) as row
        from public.client_module_access cma
        join auth.users u on u.id = cma.client_user_id
        left join public.treasury_client_operator_profile prof
          on prof.distributor_tenant_id = cma.distributor_tenant_id
         and prof.client_user_id = cma.client_user_id
        where cma.distributor_tenant_id = p_tenant_id
          and cma.module_id = v_treasury_module_id
          and cma.status = 'active'
      ) clients
    ),
    '[]'::jsonb
  );
end;
$$;
