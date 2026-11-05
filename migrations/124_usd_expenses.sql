-- Game Club expenses can be paid from the US dollars the club bought through
-- money exchanges (092). A dollar expense records the dollars spent
-- (`usd_amount`) and the rate the person entered (`usd_rate`, UZS per dollar);
-- `amount` stays the expense in sums (dollars x rate, rounded), so every total
-- and profit figure keeps counting it in UZS.
--
-- Dollars are their own holding: a dollar expense lowers the dollars held, never
-- cash, terminal, card or PlayStation money. Like PlayStation money it is not a
-- configurable club method, and a Bar expense can never name it.
-- Re-runnable. Apply before the application code that offers the method.

alter table public.expenses
  add column if not exists usd_amount numeric(16,2),
  add column if not exists usd_rate numeric(16,2);

alter table public.expenses
  drop constraint if exists expenses_payment_method_check,
  add constraint expenses_payment_method_check
    check (payment_method in ('cash', 'terminal', 'card', 'playstation', 'usd')) not valid;
alter table public.expenses validate constraint expenses_payment_method_check;

alter table public.expenses
  drop constraint if exists expenses_usd_is_game_club,
  add constraint expenses_usd_is_game_club
    check (payment_method <> 'usd' or payment_source = 'game_club') not valid;
alter table public.expenses validate constraint expenses_usd_is_game_club;

-- Dollars and rate exist exactly on dollar expenses, and the sums match them.
alter table public.expenses
  drop constraint if exists expenses_usd_amounts,
  add constraint expenses_usd_amounts check (
    case when payment_method = 'usd' then
      usd_amount is not null and usd_amount > 0 and usd_amount < 100000000000000
      and usd_rate is not null and usd_rate > 0 and usd_rate < 100000000000000
      and amount = round(usd_amount * usd_rate)
    else usd_amount is null and usd_rate is null end
  ) not valid;
alter table public.expenses validate constraint expenses_usd_amounts;

-- Unchanged from 114 except that a dollar expense cannot be moved to or from
-- dollars: its sums were converted at its own rate.
create or replace function public.update_expense_payment_method(
  p_club_id uuid, p_expense_id uuid, p_payment_method text
) returns void language plpgsql security definer set search_path = public as $$
declare methods text[];
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can change an expense.' using errcode = '42501';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'terminal', 'card', 'playstation') then
    raise exception 'Invalid payment method.';
  end if;
  select enabled_payment_methods into methods from public.clubs where id = p_club_id;
  if p_payment_method <> 'playstation' and methods is not null and not (p_payment_method = any(methods)) then
    raise exception 'Payment method is not enabled for this club.';
  end if;
  if exists (
    select 1 from public.expenses
    where club_id = p_club_id and id = p_expense_id and payment_method = 'usd'
  ) then
    raise exception 'A dollar expense keeps its payment method.' using errcode = '23514';
  end if;
  update public.expenses set payment_method = p_payment_method
    where club_id = p_club_id and id = p_expense_id;
  if not found then raise exception 'Expense does not belong to this club.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.update_expense_payment_method(uuid,uuid,text) from public, anon;
grant execute on function public.update_expense_payment_method(uuid,uuid,text) to authenticated;

-- Per-method owner withdrawal limits: unchanged from 114 except that dollar
-- expenses are left out (they no longer fall into card).
create or replace function public.owner_payment_method_earned_for_month(
  p_club_id uuid,
  p_payment_method text,
  p_period_month date
)
returns numeric
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  month_start date := date_trunc('month', p_period_month)::date;
  next_month date := (date_trunc('month', p_period_month) + interval '1 month')::date;
  earned numeric := 0;
begin
  if p_payment_method is null or p_payment_method not in ('cash', 'terminal', 'card', 'playstation') then
    raise exception 'Unknown owner withdrawal payment method: %', p_payment_method
      using errcode = '23514';
  end if;

  select coalesce(sum(case p_payment_method
      when 'cash' then coalesce(cash_income, 0)
      when 'terminal' then coalesce(terminal_income, 0)
      when 'card' then coalesce(card_income, 0)
      else coalesce(playstation_income, 0)
    end), 0)
  into earned
  from public.daily_cash_entries
  where club_id = p_club_id
    and date >= month_start
    and date < next_month;

  select earned - coalesce(sum(amount), 0)
  into earned
  from public.expenses
  where club_id = p_club_id
    and date >= month_start
    and date < next_month
    and coalesce(payment_source, 'game_club') = 'game_club'
    and payment_method is distinct from 'usd'
    and case when payment_method in ('cash', 'terminal', 'playstation') then payment_method else 'card' end
      = p_payment_method;

  if p_payment_method <> 'playstation' then
    select earned + coalesce(sum(amount), 0)
    into earned
    from public.debt_payments
    where club_id = p_club_id
      and date >= month_start
      and date < next_month
      and case when payment_method in ('cash', 'terminal') then payment_method else 'card' end
        = p_payment_method;

    select earned
      + coalesce(sum(case when to_method = p_payment_method then to_amount else 0 end), 0)
      - coalesce(sum(case when from_method = p_payment_method then from_amount else 0 end), 0)
    into earned
    from public.money_exchanges
    where club_id = p_club_id
      and date >= month_start
      and date < next_month
      and (from_method = p_payment_method or to_method = p_payment_method);
  end if;

  select earned + coalesce(sum(case when to_month = month_start then amount else -amount end), 0)
  into earned
  from public.owner_profit_carryovers
  where club_id = p_club_id
    and source = 'game_club'
    and payment_method = p_payment_method
    and (to_month = month_start or from_month = month_start);

  return earned;
end;
$$;

revoke all on function public.owner_payment_method_earned_for_month(uuid, text, date)
  from public, anon, authenticated;

-- get_owner_profit_snapshot (050) counts every expense that is not cash or
-- terminal as card. Unchanged from 114 except that dollar expenses are also
-- taken back out of card, into no method: they were paid from dollars.
create or replace function public.get_owner_profit_snapshot_with_methods(
  p_club_id uuid,
  p_through_date date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  -- The 050 snapshot authorizes the caller for the club and raises otherwise.
  snapshot jsonb := public.get_owner_profit_snapshot(p_club_id, p_through_date);
  by_month jsonb := snapshot->'paymentMethodBalancesByMonth';
  overall jsonb := snapshot->'paymentMethodBalances';
  spent record;
begin
  for spent in
    select to_char(expenses.date, 'YYYY-MM') as month, expenses.payment_method as method, sum(expenses.amount) as amount
    from public.expenses expenses
    where expenses.club_id = p_club_id
      and expenses.date <= p_through_date
      and expenses.payment_method in ('playstation', 'usd')
    group by 1, 2
  loop
    by_month := by_month || jsonb_build_object(spent.month, (by_month->spent.month) || jsonb_build_object(
      'card', (by_month->spent.month->>'card')::numeric + spent.amount
    ));
    overall := overall || jsonb_build_object('card', (overall->>'card')::numeric + spent.amount);
    if spent.method = 'playstation' then
      by_month := by_month || jsonb_build_object(spent.month, (by_month->spent.month) || jsonb_build_object(
        'playstation', (by_month->spent.month->>'playstation')::numeric - spent.amount
      ));
      overall := overall || jsonb_build_object('playstation', (overall->>'playstation')::numeric - spent.amount);
    end if;
  end loop;

  return snapshot
    || jsonb_build_object('paymentMethodBalancesByMonth', by_month, 'paymentMethodBalances', overall)
    || jsonb_build_object('withdrawalRows', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.period_month desc, rows.created_at desc, rows.id)
      from (
        select id, club_id, period_month, source, payment_method, amount, comment, created_by, created_at, updated_at
        from public.owner_withdrawals
        where club_id = p_club_id and period_month <= date_trunc('month', p_through_date)::date
      ) rows
    ), '[]'::jsonb));
end;
$$;

revoke all on function public.get_owner_profit_snapshot_with_methods(uuid, date) from public, anon;
grant execute on function public.get_owner_profit_snapshot_with_methods(uuid, date) to authenticated;
