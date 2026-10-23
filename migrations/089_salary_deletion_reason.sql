-- Deleting a payroll record now requires a written reason, kept on the audited row.
alter table public.salary_entries add column if not exists delete_reason text;
alter table public.salary_rates add column if not exists delete_reason text;

drop function if exists public.delete_salary_record(uuid, uuid, text);

create or replace function public.delete_salary_record(p_club_id uuid, p_id uuid, p_kind text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare employee_id_value uuid; reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not public.current_user_can_access_club_feature(p_club_id, 'salaries') then
    raise exception 'Salary editing access is required.' using errcode = '42501';
  end if;
  if p_kind = 'rate' and public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can change payroll terms.' using errcode = '42501';
  end if;
  if reason = '' or length(reason) > 500 then raise exception 'A deletion reason is required.'; end if;
  if p_kind = 'entry' then
    select employee_id into employee_id_value from public.salary_entries where club_id=p_club_id and id=p_id;
  elsif p_kind = 'rate' then
    select employee_id into employee_id_value from public.salary_rates where club_id=p_club_id and id=p_id;
  else raise exception 'Invalid salary record type.';
  end if;
  if employee_id_value is null then raise exception 'Record does not belong to this club.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(employee_id_value::text, 0));
  perform 1 from public.salary_employees where club_id=p_club_id and id=employee_id_value for update;
  if p_kind = 'entry' then
    update public.salary_entries set deleted_at=now(),deleted_by=auth.uid(),delete_reason=reason
      where club_id=p_club_id and id=p_id and deleted_at is null;
    delete from public.expenses where club_id=p_club_id and salary_entry_id=p_id;
  else
    if exists (select 1 from public.salary_rates where club_id=p_club_id and id=p_id and deleted_at is null)
      and not exists (select 1 from public.salary_rates where club_id=p_club_id
        and employee_id=employee_id_value and id<>p_id and deleted_at is null) then
      raise exception 'The last salary rate cannot be deleted. Change salary settings or deactivate the employee instead.';
    end if;
    update public.salary_rates set deleted_at=now(),deleted_by=auth.uid(),delete_reason=reason
      where club_id=p_club_id and id=p_id and deleted_at is null;
  end if;
end;
$$;
revoke all on function public.delete_salary_record(uuid,uuid,text,text) from public,anon;
grant execute on function public.delete_salary_record(uuid,uuid,text,text) to authenticated;
