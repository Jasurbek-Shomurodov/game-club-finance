-- A Game Club expense cannot spend more than its payment method holds.
--
-- A UZS method (cash, terminal, card, PlayStation) holds what the Reports page
-- shows as "left" for the expense's month: collections plus debt payments,
-- minus Game Club expenses paid that way, plus or minus exchanges. Dollars hold
-- every dollar bought minus sold minus spent by dollar expenses, at any date.
--
-- The check runs for application users (auth.uid() set) on manual Game Club
-- expenses. Payroll expenses (written with their salary entry) and Bar
-- expenses are not limited here. A per-club advisory lock serialises the check
-- so two simultaneous expenses cannot both spend the same money.
-- Re-runnable.

create or replace function public.expense_method_balance(
  p_club_id uuid,
  p_method text,
  p_date date,
  p_exclude_expense uuid default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  month_start date := date_trunc('month', p_date)::date;
  next_month date := (date_trunc('month', p_date) + interval '1 month')::date;
  balance numeric := 0;
begin
  if p_method = 'usd' then
    select coalesce(sum(case when to_method = 'usd' then to_amount else -from_amount end), 0)
    into balance
    from public.money_exchanges
    where club_id = p_club_id and (to_method = 'usd' or from_method = 'usd');

    select balance - coalesce(sum(usd_amount), 0)
    into balance
    from public.expenses
    where club_id = p_club_id
      and payment_method = 'usd'
      and id is distinct from p_exclude_expense;
    return balance;
  end if;

  if p_method is null or p_method not in ('cash', 'terminal', 'card', 'playstation') then
    raise exception 'Unknown payment method: %', p_method using errcode = '22023';
  end if;

  select coalesce(sum(case p_method
      when 'cash' then coalesce(cash_income, 0)
      when 'terminal' then coalesce(terminal_income, 0)
      when 'card' then coalesce(card_income, 0)
      else coalesce(playstation_income, 0)
    end), 0)
  into balance
  from public.daily_cash_entries
  where club_id = p_club_id and date >= month_start and date < next_month;

  select balance - coalesce(sum(amount), 0)
  into balance
  from public.expenses
  where club_id = p_club_id
    and date >= month_start and date < next_month
    and coalesce(payment_source, 'game_club') = 'game_club'
    and payment_method is distinct from 'usd'
    and case when payment_method in ('cash', 'terminal', 'playstation') then payment_method else 'card' end = p_method
    and id is distinct from p_exclude_expense;

  if p_method <> 'playstation' then
    select balance + coalesce(sum(amount), 0)
    into balance
    from public.debt_payments
    where club_id = p_club_id
      and date >= month_start and date < next_month
      and case when payment_method in ('cash', 'terminal') then payment_method else 'card' end = p_method;

    select balance
      + coalesce(sum(case when to_method = p_method then to_amount else 0 end), 0)
      - coalesce(sum(case when from_method = p_method then from_amount else 0 end), 0)
    into balance
    from public.money_exchanges
    where club_id = p_club_id
      and date >= month_start and date < next_month
      and (from_method = p_method or to_method = p_method);
  end if;

  return balance;
end;
$$;

revoke all on function public.expense_method_balance(uuid, text, date, uuid) from public, anon, authenticated;

-- What each method can pay on a date, for the expense form, plus the latest
-- dollar rate to suggest. Any member of the club may read it.
create or replace function public.get_expense_method_balances(p_club_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is null then
    raise exception 'Not a member of this club.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'cash', public.expense_method_balance(p_club_id, 'cash', p_date),
    'terminal', public.expense_method_balance(p_club_id, 'terminal', p_date),
    'card', public.expense_method_balance(p_club_id, 'card', p_date),
    'playstation', public.expense_method_balance(p_club_id, 'playstation', p_date),
    'usd', public.expense_method_balance(p_club_id, 'usd', p_date),
    'usdRate', (
      select rate from public.money_exchanges
      where club_id = p_club_id and rate is not null and date <= p_date
      order by date desc, created_at desc
      limit 1
    )
  );
end;
$$;

revoke all on function public.get_expense_method_balances(uuid, date) from public, anon;
grant execute on function public.get_expense_method_balances(uuid, date) to authenticated;

create or replace function public.enforce_expense_method_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  available numeric;
  spent numeric;
  spent_before numeric;
  method text;
begin
  -- Plain assignments: PL/pgSQL ends an IF condition at the first THEN, even one inside a CASE.
  spent := case when new.payment_method = 'usd' then new.usd_amount else new.amount end;
  if tg_op = 'UPDATE' then
    spent_before := case when old.payment_method = 'usd' then old.usd_amount else old.amount end;
  end if;
  method := case when new.payment_method in ('cash', 'terminal', 'playstation', 'usd') then new.payment_method else 'card' end;
  if auth.uid() is null
    or new.salary_entry_id is not null
    or coalesce(new.payment_source, 'game_club') <> 'game_club' then
    return new;
  end if;
  -- A correction that spends no more from the same method and month is always fine.
  if tg_op = 'UPDATE'
    and old.payment_method is not distinct from new.payment_method
    and coalesce(old.payment_source, 'game_club') = 'game_club'
    and (new.payment_method = 'usd' or date_trunc('month', old.date) = date_trunc('month', new.date))
    and spent <= spent_before then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('expense_method_balance:' || new.club_id::text, 0));
  available := public.expense_method_balance(new.club_id, method, new.date, new.id);
  if spent > available then
    raise exception 'Insufficient payment method balance: % available', available
      using errcode = 'P0001', hint = 'INSUFFICIENT_BALANCE';
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_method_balance on public.expenses;
create trigger expenses_method_balance
  before insert or update of amount, payment_method, payment_source, date, usd_amount on public.expenses
  for each row execute function public.enforce_expense_method_balance();
