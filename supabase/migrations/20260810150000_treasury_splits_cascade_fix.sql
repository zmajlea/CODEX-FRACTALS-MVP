-- Spec 65: allow cascade-delete of splits when parent tx is gone
create or replace function public.treasury_transaction_splits_check_sum()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx_id uuid;
  v_tx_amount numeric;
  v_slice_count bigint;
  v_slice_sum numeric;
begin
  v_tx_id := coalesce(new.transaction_id, old.transaction_id);

  select t.amount into v_tx_amount
  from public.treasury_transactions t
  where t.id = v_tx_id;

  -- Parent already deleted (ON DELETE CASCADE) — nothing to enforce.
  if v_tx_amount is null then
    return coalesce(new, old);
  end if;

  select count(*)::bigint, coalesce(sum(s.amount), 0)
  into v_slice_count, v_slice_sum
  from public.treasury_transaction_splits s
  where s.transaction_id = v_tx_id;

  if v_slice_count = 0 then
    return coalesce(new, old);
  end if;

  if abs(v_slice_sum - v_tx_amount) > 0.01 then
    raise exception
      'treasury_transaction_splits: slices sum to % but transaction amount is % (±0.01)',
      v_slice_sum,
      v_tx_amount;
  end if;

  return coalesce(new, old);
end;
$$;
