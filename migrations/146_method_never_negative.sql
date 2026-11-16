-- A payment method never goes negative on any day.
--
-- 125 and 144 limit an expense or exchange by its month's money left, so an
-- expense dated the 3rd could spend money that only arrives on the 20th, and
-- a backdated entry could leave an earlier day negative while the month still
-- added up. From now on every write that takes money out of a method is
-- checked day by day: from the write's date onward, the method's running
-- balance must stay at zero or above on every day.
--
-- The running balance of a UZS method (cash, terminal, card, PlayStation)
-- starts each month at zero: collections and debt payments in, Game Club
-- expenses out (not Bar expenses, nor reserve purchases, which the reserve
-- pays), exchanges in and out, and money put into the reserve out (on its
-- collection date; a deposit without one at the month's end). On the last day
-- it equals expense_method_balance. Dollars run across all time: bought in,
-- sold and spent out.
--
-- Checked, for application users (auth.uid() set) only:
--   expenses: inserted, or changed to spend more or earlier (payroll too; a
--             cash shortage records money already missing and is not limited);
--   money_exchanges: inserted (the "from" method) or deleted (the "to" method);
--   daily_cash_entries: changed to collect less or moved, or deleted;
--   owner_reserve_entries: a Game Club deposit inserted, or a return deleted.
-- Collecting a day (137) deposits only what is still there, so it never fails.
-- Writes that only add money are never refused. The check runs after the
-- write, under the same per-club lock as 125 and 144, so it sees the result.
-- Days before the write's date are not checked: old entries that were already
-- negative do not block today's work. Re-runnable.

create or replace function public.method_daily_lowest_balance(p_club_id uuid, p_method text, p_from date)
returns numeric language sql stable security definer set search_path = public as $$
  with bounds as (
    select
      case when p_method = 'usd' then date '-infinity' else date_trunc('month', p_from)::date end as lo,
      case when p_method = 'usd' then date 'infinity' else (date_trunc('month', p_from) + interval '1 month')::date end as hi,
      date_trunc('month', p_from)::date as month_start
  ), flows(day, amount) as (
    select e.date, case p_method
        when 'cash' then coalesce(e.cash_income, 0)
        when 'terminal' then coalesce(e.terminal_income, 0)
        when 'card' then coalesce(e.card_income, 0)
        else coalesce(e.playstation_income, 0) end
    from public.daily_cash_entries e, bounds b
    where p_method in ('cash', 'terminal', 'card', 'playstation')
      and e.club_id = p_club_id and e.date >= b.lo and e.date < b.hi
    union all
    select x.date, -case when p_method = 'usd' then coalesce(x.usd_amount, 0) else x.amount end
    from public.expenses x, bounds b
    where x.club_id = p_club_id and x.date >= b.lo and x.date < b.hi
      and case when p_method = 'usd' then x.payment_method = 'usd'
        else coalesce(x.payment_source, 'game_club') = 'game_club'
          and x.payment_method is distinct from 'usd'
          and not x.paid_from_reserve
          and case when x.payment_method in ('cash', 'terminal', 'playstation') then x.payment_method else 'card' end = p_method
        end
    union all
    select d.date, d.amount
    from public.debt_payments d, bounds b
    where p_method in ('cash', 'terminal', 'card')
      and d.club_id = p_club_id and d.date >= b.lo and d.date < b.hi
      and case when d.payment_method in ('cash', 'terminal') then d.payment_method else 'card' end = p_method
    union all
    select m.date, case when m.to_method = p_method then m.to_amount else 0 end
      - case when m.from_method = p_method then m.from_amount else 0 end
    from public.money_exchanges m, bounds b
    where m.club_id = p_club_id and m.date >= b.lo and m.date < b.hi
      and (m.from_method = p_method or m.to_method = p_method)
    union all
    select coalesce(r.collection_date, (b.month_start + interval '1 month - 1 day')::date),
      case r.kind when 'deposit' then -r.amount else r.amount end
    from public.owner_reserve_entries r, bounds b
    where p_method in ('cash', 'terminal', 'card', 'playstation')
      and r.club_id = p_club_id and r.source = 'game_club' and r.payment_method = p_method
      and r.period_month = b.month_start
  ), days as (
    select day, sum(sum(amount)) over (order by day) as balance
    from flows group by day
  )
  select min(balance) from days where day >= p_from
$$;
revoke all on function public.method_daily_lowest_balance(uuid, text, date) from public, anon, authenticated;

-- Refuses the current write when it leaves the method negative on any day from p_from on.
create or replace function public.assert_method_never_negative(p_club_id uuid, p_method text, p_from date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lowest numeric;
begin
  if auth.uid() is null or p_club_id is null or p_method is null or p_from is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('expense_method_balance:' || p_club_id::text, 0));
  lowest := public.method_daily_lowest_balance(p_club_id, p_method, p_from);
  if lowest < 0 then
    raise exception 'Insufficient payment method balance: % would be negative by %', p_method, -lowest
      using errcode = 'P0001', hint = 'INSUFFICIENT_BALANCE';
  end if;
end;
$$;
revoke all on function public.assert_method_never_negative(uuid, text, date) from public, anon, authenticated;

create or replace function public.expense_method_bucket(p_method text)
returns text language sql immutable set search_path = public as $$
  select case when p_method in ('cash', 'terminal', 'playstation', 'usd') then p_method else 'card' end
$$;
revoke all on function public.expense_method_bucket(text) from public, anon, authenticated;

create or replace function public.expenses_never_negative() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  spent numeric := case when new.payment_method = 'usd' then new.usd_amount else new.amount end;
  spent_before numeric;
begin
  -- Plain assignment: PL/pgSQL ends an IF condition at the first THEN, even one inside a CASE.
  if tg_op = 'UPDATE' then
    spent_before := case when old.payment_method = 'usd' then old.usd_amount else old.amount end;
  end if;
  -- Paid by money that is not a Game Club method, or a shortage already gone.
  if new.cash_shortage_id is not null or new.paid_from_reserve
    or (coalesce(new.payment_source, 'game_club') <> 'game_club' and new.payment_method is distinct from 'usd') then
    return null;
  end if;
  -- A change that spends no more, from the same method, no earlier, is always fine.
  if tg_op = 'UPDATE'
    and public.expense_method_bucket(old.payment_method) = public.expense_method_bucket(new.payment_method)
    and coalesce(old.payment_source, 'game_club') = coalesce(new.payment_source, 'game_club')
    and not old.paid_from_reserve
    and old.cash_shortage_id is null
    and new.date >= old.date
    and spent <= spent_before then
    return null;
  end if;
  perform public.assert_method_never_negative(new.club_id, public.expense_method_bucket(new.payment_method), new.date);
  return null;
end;
$$;
revoke all on function public.expenses_never_negative() from public, anon, authenticated;
drop trigger if exists expenses_never_negative on public.expenses;
create trigger expenses_never_negative after insert or update on public.expenses
  for each row execute function public.expenses_never_negative();

create or replace function public.money_exchanges_never_negative() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.assert_method_never_negative(new.club_id, new.from_method, new.date);
  else
    perform public.assert_method_never_negative(old.club_id, old.to_method, old.date);
  end if;
  return null;
end;
$$;
revoke all on function public.money_exchanges_never_negative() from public, anon, authenticated;
drop trigger if exists money_exchanges_never_negative on public.money_exchanges;
create trigger money_exchanges_never_negative after insert or delete on public.money_exchanges
  for each row execute function public.money_exchanges_never_negative();

create or replace function public.daily_cash_never_negative() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  method text;
  before_amount numeric;
  after_amount numeric;
  from_day date := case when tg_op = 'DELETE' then old.date else least(old.date, new.date) end;
begin
  foreach method in array array['cash', 'terminal', 'card', 'playstation'] loop
    before_amount := case method when 'cash' then old.cash_income when 'terminal' then old.terminal_income
      when 'card' then old.card_income else old.playstation_income end;
    after_amount := case when tg_op = 'DELETE' then 0 else case method when 'cash' then new.cash_income
      when 'terminal' then new.terminal_income when 'card' then new.card_income else new.playstation_income end end;
    if coalesce(after_amount, 0) < coalesce(before_amount, 0)
      or (tg_op = 'UPDATE' and new.date > old.date and coalesce(before_amount, 0) > 0) then
      perform public.assert_method_never_negative(old.club_id, method, from_day);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.daily_cash_never_negative() from public, anon, authenticated;
drop trigger if exists daily_cash_never_negative on public.daily_cash_entries;
create trigger daily_cash_never_negative after update or delete on public.daily_cash_entries
  for each row execute function public.daily_cash_never_negative();

create or replace function public.owner_reserve_never_negative() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  entry public.owner_reserve_entries := case when tg_op = 'INSERT' then new else old end;
begin
  if entry.source <> 'game_club' or entry.payment_method not in ('cash', 'terminal', 'card', 'playstation')
    or (tg_op = 'INSERT') <> (entry.kind = 'deposit') then
    return null;
  end if;
  perform public.assert_method_never_negative(
    entry.club_id, entry.payment_method,
    coalesce(entry.collection_date, (entry.period_month + interval '1 month - 1 day')::date));
  return null;
end;
$$;
revoke all on function public.owner_reserve_never_negative() from public, anon, authenticated;
drop trigger if exists owner_reserve_never_negative on public.owner_reserve_entries;
create trigger owner_reserve_never_negative after insert or delete on public.owner_reserve_entries
  for each row execute function public.owner_reserve_never_negative();

-- 137, except a day's deposit is also capped by what the method still holds
-- on every day from the collected date on: money that a later expense or
-- exchange already spent cannot be collected, so collecting never fails.
create or replace function public.mark_daily_cash_collected(p_club_id uuid, p_date date)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  month_start date := date_trunc('month', p_date)::date;
  method text;
  amount numeric;
begin
  if auth.uid() is null or not public.current_user_can_access_club_feature(p_club_id, 'collection') then
    raise exception 'Collection access is required to mark money as collected.' using errcode = '42501';
  end if;
  if p_date is null or p_date < date '2000-01-01' or p_date > public.club_business_date(p_club_id) then
    raise exception 'Invalid collection date.' using errcode = '22007';
  end if;
  insert into public.daily_cash_collections(club_id, date, collected_by)
    values (p_club_id, p_date, auth.uid())
    on conflict (club_id, date) do nothing;
  if not found then
    return false;
  end if;

  -- Same bucket lock as owner withdrawals, carryovers and manual deposits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':game_club:' || month_start::text, 0));
  foreach method in array array['cash', 'terminal', 'card', 'playstation'] loop
    amount := least(
      public.collection_day_method_money(p_club_id, method, p_date),
      public.owner_profit_bucket_available(p_club_id, 'game_club', method, month_start),
      coalesce(public.method_daily_lowest_balance(p_club_id, method, p_date), 0)
    );
    amount := floor(amount);
    if amount > 0 then
      insert into public.owner_reserve_entries
        (id, club_id, kind, period_month, source, payment_method, amount, comment, created_by, collection_date)
        values (gen_random_uuid(), p_club_id, 'deposit', month_start, 'game_club', method, amount, null, auth.uid(), p_date);
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.mark_daily_cash_collected(uuid, date) from public, anon;
grant execute on function public.mark_daily_cash_collected(uuid, date) to authenticated;
