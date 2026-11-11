-- A third KPI basis, `game_club_income`: the KPI percentage of each day's Game
-- Club income (cash + terminal + card + PlayStation in daily_cash_entries). No
-- expense, salary or bar figure lowers it, so a 5 000 000 day at 10% earns
-- 500 000 that day. It always draws from the Game Club pool only.
--
-- get_salary_profit_snapshot additionally returns `dailyGameClubIncome`, one
-- total per business date of the club (never per payment method), so payroll
-- can credit KPI on the day the income was taken. Older clients ignore the key.
--
-- Pixel Gaming: the owner's agreement with Izzat is 10% of what the Game Club
-- takes in each day. His only rate (from 1 Oct 2026, daily 0 + 10% KPI on
-- overall profit, Game Club + Bar) is replaced from the same date by 10% on
-- this basis. As with a backdated change_salary_term (123), the old rate is
-- soft-deleted with the same reason and stays in history. Re-runnable.

alter table public.salary_rates drop constraint if exists salary_rates_kpi_basis_check;
alter table public.salary_rates add constraint salary_rates_kpi_basis_check
  check (kpi_basis in ('owner_profit', 'overall_profit', 'game_club_income'));

alter table public.salary_rates drop constraint if exists salary_rates_kpi_income_pool_check;
alter table public.salary_rates add constraint salary_rates_kpi_income_pool_check
  check (kpi_basis <> 'game_club_income' or (kpi_game_club and not kpi_bar));

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
      'date', entries.date,
      'amount', entries.cash_income + entries.terminal_income + entries.card_income + entries.playstation_income
    ) order by entries.date)
    from public.daily_cash_entries entries
    where entries.club_id = p_club_id and entries.date <= p_through_date
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.get_salary_profit_snapshot(uuid,date) from public, anon;
grant execute on function public.get_salary_profit_snapshot(uuid,date) to authenticated;

do $$
declare
  v_club constant uuid := '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305';
  v_employee constant uuid := '996567ee-8518-458b-b729-6f3118988204';
  old public.salary_rates%rowtype;
begin
  select * into old from public.salary_rates
  where club_id = v_club and employee_id = v_employee and effective_date = date '2026-10-01'
    and deleted_at is null;
  if old.id is null or old.kpi_basis = 'game_club_income' then
    return;
  end if;

  update public.salary_rates
  set deleted_at = now(), deleted_by = old.created_by,
      delete_reason = 'Replaced by a backdated salary change'
  where id = old.id;

  insert into public.salary_rates(club_id, employee_id, effective_date, salary_type, amount, kpi_percent,
    active, kpi_basis, kpi_game_club, kpi_bar, created_by)
  values (v_club, v_employee, old.effective_date, old.salary_type, old.amount, 10,
    old.active, 'game_club_income', true, false, old.created_by);
end $$;
