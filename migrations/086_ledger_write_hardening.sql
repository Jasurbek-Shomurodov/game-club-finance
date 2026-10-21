-- Ledger write hardening. Re-runnable: every statement is guarded or idempotent.
--
-- 1. daily_stock_counts: closing-stock snapshots are written only by the
--    SECURITY DEFINER save_closing_stock_counts (078), which validates the
--    historical chain and derives bar income. The 054 direct insert/update/
--    delete policies let an admin PATCH previous_stock or sale_price through
--    PostgREST and inflate bar income, so they are dropped. Reads are
--    unchanged; service-role scripts bypass RLS.
-- 2. expenses: created_by defaults to auth.uid() and must be the signed-in
--    user on insert (as 075 does for new_debts), and a trigger rejects dates
--    after the club business date (as 036 does for debts). Salary payments
--    insert through SECURITY DEFINER RPCs that already reject future dates.
-- 3. debt_payments: a nullable created_by (history stays unattributed) that
--    defaults to auth.uid() and must be the signed-in user on insert.
-- 4. profiles: browser roles lose UPDATE. A club owner could otherwise PATCH a
--    club-mate's global role. Rejections go through the security-definer
--    reject_access_request or the service-role /api/team/reject route.
-- 5. handle_debt_payment (001) gets a fixed search_path when it still exists.

-- 1. Closing stock writes only through save_closing_stock_counts.
drop policy if exists "club_admin_insert_stock_counts" on public.daily_stock_counts;
drop policy if exists "club_admin_update_stock_counts" on public.daily_stock_counts;
drop policy if exists "club_admin_delete_stock_counts" on public.daily_stock_counts;

-- 2. Expenses: author is the caller, date is not in the future.
alter table public.expenses
  alter column created_by set default auth.uid();

drop policy if exists "club_admin_insert_expenses" on public.expenses;
create policy "club_admin_insert_expenses" on public.expenses
  for insert with check (
    public.current_user_club_role(club_id) in ('admin', 'owner')
    and public.current_user_can_access_club_feature(club_id, 'expenses')
    and created_by = (select auth.uid())
  );

create or replace function public.enforce_expense_business_date()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.date > public.club_business_date(NEW.club_id) then
    raise exception 'Expenses cannot use a future business date'
      using errcode = '22007';
  end if;

  return NEW;
end;
$$;

revoke execute on function public.enforce_expense_business_date()
  from PUBLIC, anon, authenticated;

drop trigger if exists trg_expense_date_guard on public.expenses;
create trigger trg_expense_date_guard
  before insert on public.expenses
  for each row execute function public.enforce_expense_business_date();

-- 3. Debt payments: author is the caller.
alter table public.debt_payments
  add column if not exists created_by uuid references auth.users(id);

alter table public.debt_payments
  alter column created_by set default auth.uid();

drop policy if exists "club_admin_insert_debt_payments" on public.debt_payments;
create policy "club_admin_insert_debt_payments" on public.debt_payments
  for insert with check (
    public.current_user_club_role(club_id) in ('admin', 'owner')
    and public.current_user_can_access_club_feature(club_id, 'debts')
    and (created_by = (select auth.uid()))
  );

-- 4. Profiles are not updatable by browser roles.
revoke update on table public.profiles from anon, authenticated;

-- 5. Legacy trigger function: pin its search_path if it still exists.
do $$
begin
  if to_regprocedure('public.handle_debt_payment()') is not null then
    alter function public.handle_debt_payment() set search_path = public;
  end if;
end;
$$;
