-- The owner picks the date a deactivated employee comes back from, instead of
-- activation always starting on the business date. Salary and KPI accrue from
-- that date; a date inside the inactive stretch backdates the return, and the
-- day the stretch began cancels the gap entirely.
drop function if exists public.activate_salary_employee(uuid,uuid);
create or replace function public.activate_salary_employee(
  p_club_id uuid, p_employee_id uuid, p_date date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare employee public.salary_employees; rate public.salary_rates;
  v_today date; v_effective_date date;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can change payroll terms.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 0));
  select * into employee from public.salary_employees
    where club_id = p_club_id and id = p_employee_id for update;
  if not found or employee.deleted_at is not null then
    raise exception 'Employee does not belong to this club.';
  end if;
  v_today := greatest(public.club_business_date(p_club_id), employee.joined_on);
  v_effective_date := coalesce(p_date, v_today);
  if v_effective_date < employee.joined_on then
    raise exception 'Activation cannot start before the employee joins.';
  end if;
  if v_effective_date > v_today then
    raise exception 'Activation cannot start after the current business date.';
  end if;
  select * into rate from public.salary_rates
    where club_id = p_club_id and employee_id = p_employee_id
      and deleted_at is null and salary_rates.effective_date <= v_effective_date
    order by salary_rates.effective_date desc limit 1;
  if not found then raise exception 'Employee salary settings are missing.'; end if;
  -- Coming back from this date undoes any deactivation that followed it up to today.
  update public.salary_rates set deleted_at = now(), deleted_by = auth.uid(), delete_reason = 'Replaced by activation'
    where club_id = p_club_id and employee_id = p_employee_id and deleted_at is null and not active
      and salary_rates.effective_date > v_effective_date and salary_rates.effective_date <= v_today;
  if rate.active then return p_employee_id; end if;
  insert into public.salary_rates(club_id, employee_id, effective_date, salary_type, amount, kpi_percent, active, kpi_basis, kpi_game_club, kpi_bar, created_by)
    values (p_club_id, p_employee_id, v_effective_date, rate.salary_type, rate.amount, rate.kpi_percent, true, rate.kpi_basis, rate.kpi_game_club, rate.kpi_bar, auth.uid())
    on conflict (employee_id,effective_date) where deleted_at is null do update set active = true,
      created_by = excluded.created_by, created_at = now();
  return p_employee_id;
end;
$$;
revoke all on function public.activate_salary_employee(uuid,uuid,date) from public, anon;
grant execute on function public.activate_salary_employee(uuid,uuid,date) to authenticated;
