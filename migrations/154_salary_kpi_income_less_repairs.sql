-- Game Club income KPI (134, 147) also loses repairs: expenses in the
-- `repair` category (Ремонт) paid from the Game Club. From now on
-- `dailyGameClubIncome` is each business date's Game Club income minus that
-- date's Game Club `discount` and `repair` expenses. A day that goes below zero
-- still earns no KPI. `overall_profit` and `owner_profit` already subtract
-- repairs, and `monthlyBalances` is unchanged. Re-runnable.

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
        and expenses.category in ('discount', 'repair') and expenses.payment_source = 'game_club'
      group by expenses.date
    ) discounts on discounts.date = income.date
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.get_salary_profit_snapshot(uuid,date) from public, anon;
grant execute on function public.get_salary_profit_snapshot(uuid,date) to authenticated;
