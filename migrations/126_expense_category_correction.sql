-- An owner can correct an expense's category, as 090 and 095 let them correct
-- its payment method and date. Expenses are otherwise append-only for app
-- users (083), so the change goes through a security definer RPC that checks
-- ownership. Only a hand-chosen category is allowed: `salary` is written by
-- the payroll flow alone, and the protect_salary_expense trigger (059) still
-- refuses payroll-linked expenses. The lock_collected_day trigger (097) keeps
-- a collected day closed.
--
-- A preset's plan counts only payments in its own category (091), so an
-- expense moved to another category leaves its preset. Re-runnable.

create or replace function public.update_expense_category(
  p_club_id uuid, p_expense_id uuid, p_category text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can change an expense.' using errcode = '42501';
  end if;
  if p_category is null or p_category = 'salary' then
    raise exception 'Invalid expense category.' using errcode = '23514';
  end if;
  update public.expenses
    set category = p_category,
        preset_id = case when category = p_category then preset_id else null end
    where club_id = p_club_id and id = p_expense_id;
  if not found then raise exception 'Expense does not belong to this club.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.update_expense_category(uuid,uuid,text) from public, anon;
grant execute on function public.update_expense_category(uuid,uuid,text) to authenticated;
