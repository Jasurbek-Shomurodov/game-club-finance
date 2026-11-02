-- The owner can remove a deactivated employee from the salary pages. The row
-- and its ledgers stay: salary payments keep their expenses, and the hidden
-- employee stays in the KPI calculation, because KPI groups share fixed pay and
-- removing it would change other staff's past KPI. An employee who still
-- accrues cannot be hidden, and nothing new can be written for a hidden one.
alter table public.salary_employees
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists delete_reason text;

create or replace function public.delete_salary_employee(
  p_club_id uuid, p_employee_id uuid, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare employee public.salary_employees; rate public.salary_rates;
  v_today date; reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can delete payroll records.' using errcode = '42501';
  end if;
  if reason = '' or length(reason) > 500 then raise exception 'A deletion reason is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 0));
  select * into employee from public.salary_employees
    where club_id = p_club_id and id = p_employee_id for update;
  if not found then raise exception 'Employee does not belong to this club.'; end if;
  if employee.deleted_at is not null then return p_employee_id; end if;
  v_today := public.club_business_date(p_club_id);
  select * into rate from public.salary_rates
    where club_id = p_club_id and employee_id = p_employee_id
      and deleted_at is null and salary_rates.effective_date <= v_today
    order by salary_rates.effective_date desc limit 1;
  if (found and rate.active) or exists (select 1 from public.salary_rates
    where club_id = p_club_id and employee_id = p_employee_id and deleted_at is null
      and active and salary_rates.effective_date > v_today) then
    raise exception 'Deactivate the employee before deleting them.';
  end if;
  update public.salary_employees set deleted_at = now(), deleted_by = auth.uid(), delete_reason = reason
    where club_id = p_club_id and id = p_employee_id;
  return p_employee_id;
end;
$$;
revoke all on function public.delete_salary_employee(uuid,uuid,text) from public, anon;
grant execute on function public.delete_salary_employee(uuid,uuid,text) to authenticated;

create or replace function public.reject_hidden_salary_employee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.salary_employees
    where club_id = NEW.club_id and id = NEW.employee_id and deleted_at is not null) then
    raise exception 'Employee does not belong to this club.';
  end if;
  return NEW;
end;
$$;
revoke all on function public.reject_hidden_salary_employee() from public, anon, authenticated;
drop trigger if exists salary_rates_reject_hidden_employee on public.salary_rates;
create trigger salary_rates_reject_hidden_employee before insert on public.salary_rates
  for each row execute function public.reject_hidden_salary_employee();
drop trigger if exists salary_entries_reject_hidden_employee on public.salary_entries;
create trigger salary_entries_reject_hidden_employee before insert on public.salary_entries
  for each row execute function public.reject_hidden_salary_employee();
