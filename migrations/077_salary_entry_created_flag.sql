-- Report whether a salary entry was newly recorded, so the API notifies the
-- club group exactly once without a racy "does it exist yet" read beforehand.
-- Same validation, locking and idempotency as record_salary_entry (062), which
-- stays unchanged for older application versions; only the return differs.
create function public.record_salary_entry_with_status(
  p_club_id uuid, p_employee_id uuid, p_request_id uuid, p_date date,
  p_kind text, p_amount numeric, p_comment text, p_payment_method text default null, p_payment_source text default null
) returns table(entry_id uuid, created boolean) language plpgsql security definer set search_path = public as $$
declare employee public.salary_employees; existing public.salary_entries; methods text[];
begin
  if auth.uid() is null or not public.current_user_can_access_club_feature(p_club_id, 'salaries') then
    raise exception 'Salary editing access is required.' using errcode = '42501';
  end if;
  select * into employee from public.salary_employees where club_id = p_club_id and id = p_employee_id for update;
  if not found then raise exception 'Employee does not belong to this club.'; end if;
  if p_request_id is null or p_date is null or p_date < employee.joined_on or p_date > public.club_business_date(p_club_id)
    or p_amount is null or p_amount <= 0 or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_amount <> round(p_amount, 2) then raise exception 'Invalid salary entry.'; end if;
  select * into existing from public.salary_entries where club_id = p_club_id and id = p_request_id;
  if found then
    if existing.employee_id is distinct from p_employee_id or existing.date is distinct from p_date
      or existing.kind is distinct from p_kind or existing.amount is distinct from p_amount
      or existing.comment is distinct from coalesce(p_comment,'')
      or existing.payment_method is distinct from p_payment_method or existing.payment_source is distinct from p_payment_source then
      raise exception 'This request has already been used for a different entry.';
    end if;
    return query select existing.id, false;
    return;
  end if;
  if p_kind = 'payment' then
    select enabled_payment_methods into methods from public.clubs where id = p_club_id;
    if p_payment_method is null or not (p_payment_method = any(methods)) then
      raise exception 'Payment method is not enabled for this club.';
    end if;
  end if;
  insert into public.salary_entries(id,club_id,employee_id,date,kind,amount,comment,payment_method,payment_source,created_by)
    values (p_request_id,p_club_id,p_employee_id,p_date,p_kind,p_amount,coalesce(p_comment,''),p_payment_method,p_payment_source,auth.uid());
  if p_kind = 'payment' then
    insert into public.expenses(club_id,date,amount,category,payment_method,payment_source,comment,created_by,salary_entry_id)
      values (p_club_id,p_date,p_amount,'salary',p_payment_method,p_payment_source,
        employee.name || case when coalesce(p_comment,'') = '' then '' else ': ' || p_comment end,auth.uid(),p_request_id);
  end if;
  return query select p_request_id, true;
end;
$$;

revoke all on function public.record_salary_entry_with_status(uuid,uuid,uuid,date,text,numeric,text,text,text) from public, anon;
grant execute on function public.record_salary_entry_with_status(uuid,uuid,uuid,date,text,numeric,text,text,text) to authenticated;
