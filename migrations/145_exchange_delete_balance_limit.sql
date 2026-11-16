-- Deleting an exchange cannot leave its "to" method negative.
--
-- 144 stops an exchange from giving away money its "from" method does not
-- hold. Deleting one takes back the money its "to" method received: when that
-- money was already spent or exchanged again, the method would go negative.
-- The owner deletes the later expenses or exchanges first.
--
-- The check is the same balance and per-club lock as expenses (125) and new
-- exchanges (144): expense_method_balance for the "to" method on the
-- exchange's date (the month's money left for UZS methods, every dollar still
-- held for dollars) must still cover what the exchange put there. Only this
-- RPC deletes exchanges; it stays owner-only (092). Re-runnable.

create or replace function public.delete_money_exchange(p_club_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  existing public.money_exchanges;
  available numeric;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can delete an exchange.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('expense_method_balance:' || p_club_id::text, 0));
  select * into existing from public.money_exchanges where club_id = p_club_id and id = p_id for update;
  if not found then raise exception 'Exchange does not belong to this club.' using errcode = 'P0002'; end if;

  available := public.expense_method_balance(p_club_id, existing.to_method, existing.date);
  if existing.to_amount > available then
    raise exception 'Insufficient payment method balance: % available', available
      using errcode = 'P0001', hint = 'INSUFFICIENT_BALANCE';
  end if;

  delete from public.money_exchanges where id = existing.id;
end;
$$;
revoke all on function public.delete_money_exchange(uuid,uuid) from public, anon;
grant execute on function public.delete_money_exchange(uuid,uuid) to authenticated;
