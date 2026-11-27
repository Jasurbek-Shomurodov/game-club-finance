-- Salaries accept the "Game Club income" KPI basis
-- (docs/plans/logic-audit-fixes.md, slice 2).
--
-- Migration 134 added `game_club_income` to salary_rates' kpi_basis check
-- constraint, but save_salary_employee (070) and change_salary_term (123)
-- still raised "Invalid KPI settings." for any basis other than owner_profit
-- or overall_profit. So choosing the basis in the salary form always failed,
-- and so did a same-day salary change for an employee already on it (the
-- change keeps the rate's basis and goes through save_salary_employee).
--
-- Both functions are re-created from those latest bodies with the basis
-- check widened to `game_club_income`. For that basis the KPI pools are
-- normalised to Game Club only (kpi_game_club = true, kpi_bar = false), as
-- 134's salary_rates_kpi_income_pool_check requires. Every other line is
-- unchanged, and so are the signatures and grants.
--
-- REPLACES TWO PAYROLL RPCS (a financial RPC replacement): save_salary_employee
-- and change_salary_term. No table, column or row is changed. Re-runnable.

create or replace function public.save_salary_employee(
  p_club_id uuid, p_employee_id uuid, p_name text, p_job_title text,
  p_effective_date date, p_salary_type text, p_amount numeric, p_kpi_percent numeric, p_active boolean,
  p_kpi_basis text default null, p_kpi_game_club boolean default null, p_kpi_bar boolean default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare existing public.salary_employees; business_date date; cur public.salary_rates;
  v_basis text; v_game_club boolean; v_bar boolean; v_known boolean;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can change payroll terms.' using errcode = '42501';
  end if;
  business_date := public.club_business_date(p_club_id);
  if p_employee_id is null or p_effective_date is null
    or p_effective_date < date '2000-01-01' or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_amount <> round(p_amount, 2) or p_kpi_percent <> round(p_kpi_percent, 2)
    or p_kpi_percent is null or p_kpi_percent::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Invalid salary settings.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 0));
  select * into existing from public.salary_employees where club_id = p_club_id and id = p_employee_id for update;
  v_known := found; -- later selects overwrite FOUND
  -- Unspecified KPI settings keep the rate in force today (new employees get the defaults).
  select * into cur from public.salary_rates
    where club_id = p_club_id and employee_id = p_employee_id and deleted_at is null
      and effective_date <= greatest(business_date, coalesce(existing.joined_on, p_effective_date))
    order by effective_date desc limit 1;
  v_basis := coalesce(p_kpi_basis, cur.kpi_basis, 'overall_profit');
  v_game_club := coalesce(p_kpi_game_club, cur.kpi_game_club, true);
  v_bar := coalesce(p_kpi_bar, cur.kpi_bar, true);
  -- Game Club income draws from the Game Club pool only (134's check constraint).
  if v_basis = 'game_club_income' then v_game_club := true; v_bar := false; end if;
  if v_basis not in ('owner_profit','overall_profit','game_club_income') or not (v_game_club or v_bar) then
    raise exception 'Invalid KPI settings.';
  end if;
  if v_known then
    if p_effective_date < existing.joined_on then raise exception 'Salary cannot start before the employee joins.'; end if;
    -- Historical rates cannot be rewritten; same-business-day corrections are allowed.
    if p_effective_date <> greatest(business_date, existing.joined_on) then
      -- A lost response to an initial backdated setup can be safely retried.
      if existing.joined_on = p_effective_date and existing.name = btrim(p_name)
        and existing.job_title = btrim(coalesce(p_job_title,'')) and exists (
          select 1 from public.salary_rates where club_id = p_club_id and employee_id = p_employee_id
            and deleted_at is null and effective_date = p_effective_date and salary_type = p_salary_type
            and amount = p_amount and kpi_percent = p_kpi_percent and active = p_active
            and kpi_basis = v_basis and kpi_game_club = v_game_club and kpi_bar = v_bar
        ) then return p_employee_id; end if;
      raise exception 'Salary changes must start on the current business date or the future joining date.';
    end if;
    update public.salary_employees set name = btrim(p_name), job_title = btrim(coalesce(p_job_title,''))
      where club_id = p_club_id and id = p_employee_id;
  else
    insert into public.salary_employees(id, club_id, name, job_title, joined_on, created_by)
      values (p_employee_id, p_club_id, btrim(p_name), btrim(coalesce(p_job_title,'')), p_effective_date, auth.uid());
  end if;
  insert into public.salary_rates(club_id, employee_id, effective_date, salary_type, amount, kpi_percent, active, kpi_basis, kpi_game_club, kpi_bar, created_by)
    values (p_club_id,p_employee_id,p_effective_date,p_salary_type,p_amount,p_kpi_percent,p_active,v_basis,v_game_club,v_bar,auth.uid())
    on conflict (employee_id,effective_date) where deleted_at is null do update set salary_type = excluded.salary_type,
      amount = excluded.amount, kpi_percent = excluded.kpi_percent, active = excluded.active,
      kpi_basis = excluded.kpi_basis, kpi_game_club = excluded.kpi_game_club, kpi_bar = excluded.kpi_bar,
      created_by = excluded.created_by, created_at = now();
  return p_employee_id;
end;
$$;
revoke all on function public.save_salary_employee(uuid,uuid,text,text,date,text,numeric,numeric,boolean,text,boolean,boolean) from public, anon;
grant execute on function public.save_salary_employee(uuid,uuid,text,text,date,text,numeric,numeric,boolean,text,boolean,boolean) to authenticated;

create or replace function public.change_salary_term(
  p_club_id uuid, p_employee_id uuid, p_kind text, p_amount numeric,
  p_salary_type text default null, p_kpi_basis text default null,
  p_kpi_game_club boolean default null, p_kpi_bar boolean default null,
  p_effective_date date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare employee public.salary_employees; base public.salary_rates; later public.salary_rates;
  v_default date; v_date date; v_salary_type text; v_amount numeric; v_kpi numeric;
  v_basis text; v_game_club boolean; v_bar boolean;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can change payroll terms.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 0));
  select * into employee from public.salary_employees
    where club_id = p_club_id and id = p_employee_id for update;
  if not found then raise exception 'Employee does not belong to this club.'; end if;
  if p_kind is null or p_kind not in ('salary','kpi') then raise exception 'Invalid salary change.'; end if;
  v_default := greatest(public.club_business_date(p_club_id), employee.joined_on);
  v_date := coalesce(p_effective_date, v_default);
  if v_date < employee.joined_on then raise exception 'Salary cannot start before the employee joins.'; end if;
  if v_date > v_default then raise exception 'Salary changes cannot start after the current business date.'; end if;
  select * into base from public.salary_rates
    where club_id = p_club_id and employee_id = p_employee_id
      and deleted_at is null and salary_rates.effective_date <= v_date
    order by salary_rates.effective_date desc limit 1;
  if not found then raise exception 'Employee salary settings are missing.'; end if;

  if v_date = v_default then
    return public.save_salary_employee(p_club_id, p_employee_id, employee.name, employee.job_title,
      v_date,
      case when p_kind = 'salary' then p_salary_type else base.salary_type end,
      case when p_kind = 'salary' then p_amount else base.amount end,
      case when p_kind = 'kpi' then p_amount else base.kpi_percent end,
      base.active,
      case when p_kind = 'kpi' then p_kpi_basis end,
      case when p_kind = 'kpi' then p_kpi_game_club end,
      case when p_kind = 'kpi' then p_kpi_bar end);
  end if;

  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount <> round(p_amount, 2) then
    raise exception 'Invalid salary settings.';
  end if;
  if p_kind = 'salary' then
    if p_salary_type is null or p_salary_type not in ('daily','monthly') then raise exception 'Invalid salary settings.'; end if;
    v_salary_type := p_salary_type; v_amount := p_amount;
  else
    v_kpi := p_amount;
    v_basis := coalesce(p_kpi_basis, base.kpi_basis, 'overall_profit');
    v_game_club := coalesce(p_kpi_game_club, base.kpi_game_club, true);
    v_bar := coalesce(p_kpi_bar, base.kpi_bar, true);
    -- Game Club income draws from the Game Club pool only (134's check constraint).
    if v_basis = 'game_club_income' then v_game_club := true; v_bar := false; end if;
    if v_basis not in ('owner_profit','overall_profit','game_club_income') or not (v_game_club or v_bar) then
      raise exception 'Invalid KPI settings.';
    end if;
  end if;

  for later in select * from public.salary_rates
    where club_id = p_club_id and employee_id = p_employee_id
      and deleted_at is null and salary_rates.effective_date >= v_date
    order by salary_rates.effective_date
  loop
    -- A later rate that set this term differently is the next change; it and everything after it stay.
    exit when later.effective_date > v_date and (case when p_kind = 'salary'
      then (later.salary_type, later.amount) is distinct from (base.salary_type, base.amount)
      else (later.kpi_percent, later.kpi_basis, later.kpi_game_club, later.kpi_bar)
        is distinct from (base.kpi_percent, base.kpi_basis, base.kpi_game_club, base.kpi_bar) end);
    update public.salary_rates set deleted_at = now(), deleted_by = auth.uid(),
        delete_reason = 'Replaced by a backdated salary change'
      where id = later.id;
    insert into public.salary_rates(club_id, employee_id, effective_date, salary_type, amount, kpi_percent, active, kpi_basis, kpi_game_club, kpi_bar, created_by)
      values (p_club_id, p_employee_id, later.effective_date,
        coalesce(v_salary_type, later.salary_type), coalesce(v_amount, later.amount), coalesce(v_kpi, later.kpi_percent),
        later.active, coalesce(v_basis, later.kpi_basis), coalesce(v_game_club, later.kpi_game_club), coalesce(v_bar, later.kpi_bar),
        auth.uid());
  end loop;

  -- The chosen date had no rate of its own: the change starts a new one there.
  if base.effective_date < v_date then
    insert into public.salary_rates(club_id, employee_id, effective_date, salary_type, amount, kpi_percent, active, kpi_basis, kpi_game_club, kpi_bar, created_by)
      values (p_club_id, p_employee_id, v_date,
        coalesce(v_salary_type, base.salary_type), coalesce(v_amount, base.amount), coalesce(v_kpi, base.kpi_percent),
        base.active, coalesce(v_basis, base.kpi_basis), coalesce(v_game_club, base.kpi_game_club), coalesce(v_bar, base.kpi_bar),
        auth.uid());
  end if;
  return p_employee_id;
end;
$$;
revoke all on function public.change_salary_term(uuid,uuid,text,numeric,text,text,boolean,boolean,date) from public, anon;
grant execute on function public.change_salary_term(uuid,uuid,text,numeric,text,text,boolean,boolean,date) to authenticated;
