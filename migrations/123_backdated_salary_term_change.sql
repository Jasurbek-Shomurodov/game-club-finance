-- A salary or KPI change may start on a past date chosen by the owner. The
-- change replaces the rate in force on that date and carries forward through
-- later rates that still hold the old terms, stopping at the first later rate
-- that changed the same term itself. Replaced rates are soft-deleted with a
-- reason, so the history keeps what was there before. Without a date (or with
-- today's), the change is saved exactly as before.
drop function if exists public.change_salary_term(uuid,uuid,text,numeric,text,text,boolean,boolean);
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
    if v_basis not in ('owner_profit','overall_profit') or not (v_game_club or v_bar) then
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
