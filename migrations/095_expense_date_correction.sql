-- An owner can correct an expense's date, as 090 lets them correct its
-- payment method. Expenses are otherwise append-only for app users (083), so
-- the change goes through a security definer RPC that checks ownership and
-- refuses a date after the club's business date (the 086 insert rule). The
-- protect_salary_expense trigger (059) still refuses payroll-linked expenses,
-- whose date comes from the salary entry. Re-runnable.

create or replace function public.update_expense_date(
  p_club_id uuid, p_expense_id uuid, p_date date
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can change an expense.' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'Invalid expense date.' using errcode = '22007';
  end if;
  if p_date > public.club_business_date(p_club_id) then
    raise exception 'Expenses cannot use a future business date' using errcode = '22007';
  end if;
  update public.expenses set date = p_date
    where club_id = p_club_id and id = p_expense_id;
  if not found then raise exception 'Expense does not belong to this club.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.update_expense_date(uuid,uuid,date) from public, anon;
grant execute on function public.update_expense_date(uuid,uuid,date) to authenticated;
