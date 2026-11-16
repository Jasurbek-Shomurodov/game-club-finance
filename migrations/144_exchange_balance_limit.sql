-- An exchange cannot give away money its "from" method does not hold.
--
-- Expenses have been limited by the database since 125: a payment method
-- cannot pay more than its month's money left. Exchanges (092) were only
-- limited by the Reports form (826e95a), so a stale tab or a direct API call
-- could still send more cash, terminal or card money into another method or
-- into dollars than the method held, and the method went negative.
--
-- Every new exchange is now checked against the same balance an expense is:
-- expense_method_balance for the "from" method on the exchange's date (the
-- month's money left for UZS methods, every dollar still held for dollars),
-- under the same per-club lock, so an expense and an exchange saved at the
-- same moment cannot both spend the same money. Server jobs and migrations
-- (no signed-in user) are not limited, the same as expenses. Re-runnable.

create or replace function public.enforce_exchange_method_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  available numeric;
begin
  if auth.uid() is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('expense_method_balance:' || new.club_id::text, 0));
  available := public.expense_method_balance(new.club_id, new.from_method, new.date);
  if new.from_amount > available then
    raise exception 'Insufficient payment method balance: % available', available
      using errcode = 'P0001', hint = 'INSUFFICIENT_BALANCE';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_exchange_method_balance() from public, anon, authenticated;

drop trigger if exists enforce_exchange_method_balance on public.money_exchanges;
create trigger enforce_exchange_method_balance
  before insert on public.money_exchanges
  for each row execute function public.enforce_exchange_method_balance();
