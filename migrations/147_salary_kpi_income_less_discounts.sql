-- Every KPI basis loses the money given back to customers: expenses in the
-- `discount` category (Скидки и бонусы клиентам).
--
-- `overall_profit` already subtracts every expense, and `owner_profit` only
-- counts what was withdrawn after expenses, so both already lose discounts.
-- `game_club_income` (134) took each day's Game Club income before any
-- expense. From now on `dailyGameClubIncome` is that income minus the
-- `discount` expenses paid from the Game Club on the same business date, so a
-- 5 000 000 day with a 295 000 discount at 10% earns 470 500, not 500 000.
-- A day with only a discount is returned as a negative amount; payroll never
-- pays KPI below zero for a day. `monthlyBalances` is unchanged. Re-runnable.

create or replace function public.get_salary_profit_snapshot(p_club_id uuid, p_through_date date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is null then
    raise exception 'Not authorized for this club payroll.' using errcode = '42501';
  end if;
  if p_through_date is null or p_through_date > public.club_business_date(p_club_id) then
    raise exception 'Invalid payroll date.';
  end if;
  return jsonb_build_object('monthlyBalances', coalesce((
    select jsonb_agg(jsonb_build_object(
      'period_month', row->'period_month',
      'game_club_earned', row->'game_club_earned',
      'bar_earned', row->'bar_earned',
      'game_club_withdrawn', row->'game_club_withdrawn',
      'bar_withdrawn', row->'bar_withdrawn',
      'game_club_investments', coalesce(investments.game_club, 0),
      'bar_investments', coalesce(investments.bar, 0)
    ))
    from jsonb_array_elements(public.get_owner_profit_snapshot(p_club_id, p_through_date)->'monthlyBalances') row
    left join (
      select date_trunc('month', expenses.date)::date as period_month,
        sum(expenses.amount) filter (where expenses.payment_source = 'game_club') as game_club,
        sum(expenses.amount) filter (where expenses.payment_source = 'bar') as bar
      from public.expenses expenses
      where expenses.club_id = p_club_id and expenses.date <= p_through_date
        and expenses.category = 'investments'
      group by 1
    ) investments on investments.period_month = (row->>'period_month')::date
  ), '[]'::jsonb),
  'dailyGameClubIncome', coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', coalesce(income.date, discounts.date),
      'amount', coalesce(income.amount, 0) - coalesce(discounts.amount, 0)
    ) order by coalesce(income.date, discounts.date))
    from (
      select entries.date,
        entries.cash_income + entries.terminal_income + entries.card_income + entries.playstation_income as amount
      from public.daily_cash_entries entries
      where entries.club_id = p_club_id and entries.date <= p_through_date
    ) income
    full join (
      select expenses.date, sum(expenses.amount) as amount
      from public.expenses expenses
      where expenses.club_id = p_club_id and expenses.date <= p_through_date
        and expenses.category = 'discount' and expenses.payment_source = 'game_club'
      group by expenses.date
    ) discounts on discounts.date = income.date
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.get_salary_profit_snapshot(uuid,date) from public, anon;
grant execute on function public.get_salary_profit_snapshot(uuid,date) to authenticated;
