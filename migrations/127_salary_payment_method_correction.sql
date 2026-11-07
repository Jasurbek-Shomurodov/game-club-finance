-- An owner can correct the payment method of a salary payment.
--
-- A payroll expense must always match its salary entry (059/062), so the
-- method changes on both rows in one call. protect_salary_expense still refuses
-- every other edit of a payroll expense; it lets the method through only while
-- update_salary_payment_method has marked that expense for this transaction.
-- The lock_collected_day trigger (097) keeps a collected day closed. Payroll
-- expenses are not limited by the method balance (125). Re-runnable.

create or replace function public.protect_salary_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare entry public.salary_entries; method_change boolean;
begin
  if TG_OP = 'DELETE' then
    if OLD.salary_entry_id is not null and not exists (select 1 from public.salary_entries where id = OLD.salary_entry_id and club_id = OLD.club_id and deleted_at is not null) then raise exception 'Salary payments cannot be deleted.'; end if;
    return OLD;
  end if;
  method_change := TG_OP = 'UPDATE'
    and current_setting('app.salary_method_change', true) = OLD.id::text;
  if TG_OP = 'UPDATE' and OLD.salary_entry_id is not null and (
    NEW.salary_entry_id is distinct from OLD.salary_entry_id or NEW.id is distinct from OLD.id
    or NEW.club_id is distinct from OLD.club_id or NEW.date is distinct from OLD.date
    or NEW.amount is distinct from OLD.amount or NEW.category is distinct from OLD.category
    or (NEW.payment_method is distinct from OLD.payment_method and not method_change)
    or NEW.payment_source is distinct from OLD.payment_source
    or NEW.comment is distinct from OLD.comment or NEW.created_by is distinct from OLD.created_by
  ) then raise exception 'Salary payments cannot be edited.'; end if;
  if NEW.salary_entry_id is not null then
    select * into entry from public.salary_entries where id = NEW.salary_entry_id and club_id = NEW.club_id;
    if not found or entry.deleted_at is not null or entry.kind <> 'payment' or NEW.amount is distinct from entry.amount
      or NEW.date is distinct from entry.date or NEW.payment_method is distinct from entry.payment_method
      or NEW.payment_source is distinct from entry.payment_source or NEW.category <> 'salary'
      or NEW.created_by is distinct from entry.created_by then
      raise exception 'Invalid salary expense.';
    end if;
  end if;
  return NEW;
end;
$$;
revoke all on function public.protect_salary_expense() from public, anon, authenticated;

create or replace function public.update_salary_payment_method(
  p_club_id uuid, p_expense_id uuid, p_payment_method text
) returns void language plpgsql security definer set search_path = public as $$
declare expense public.expenses; entry public.salary_entries; methods text[];
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can change an expense.' using errcode = '42501';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'terminal', 'card') then
    raise exception 'Invalid payment method.';
  end if;
  select enabled_payment_methods into methods from public.clubs where id = p_club_id;
  if methods is not null and not (p_payment_method = any(methods)) then
    raise exception 'Payment method is not enabled for this club.';
  end if;
  select * into expense from public.expenses where club_id = p_club_id and id = p_expense_id;
  if not found or expense.salary_entry_id is null then
    raise exception 'Salary payment does not belong to this club.' using errcode = 'P0002';
  end if;
  select * into entry from public.salary_entries
    where club_id = p_club_id and id = expense.salary_entry_id and deleted_at is null;
  if not found then
    raise exception 'Salary payment does not belong to this club.' using errcode = 'P0002';
  end if;
  -- The same lock as recording and deleting this employee's payroll records.
  perform pg_advisory_xact_lock(hashtextextended(entry.employee_id::text, 0));
  perform 1 from public.salary_employees where club_id = p_club_id and id = entry.employee_id for update;
  if entry.payment_method = p_payment_method then return; end if;

  update public.salary_entries set payment_method = p_payment_method
    where club_id = p_club_id and id = entry.id;
  perform set_config('app.salary_method_change', p_expense_id::text, true);
  update public.expenses set payment_method = p_payment_method
    where club_id = p_club_id and id = p_expense_id;
  perform set_config('app.salary_method_change', '', true);
end;
$$;
revoke all on function public.update_salary_payment_method(uuid,uuid,text) from public, anon;
grant execute on function public.update_salary_payment_method(uuid,uuid,text) to authenticated;
