-- KPI on the overall-profit basis is profit minus every expense except
-- investments: money put into growing the club (new seats, upgrades) is the
-- owner's decision and must not lower an employee's KPI. The salary snapshot
-- now also returns each month's investment expenses per pool, which payroll
-- adds back to that pool's earned cash. Only monthly totals are exposed.
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
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.get_salary_profit_snapshot(uuid,date) from public, anon;
grant execute on function public.get_salary_profit_snapshot(uuid,date) to authenticated;
