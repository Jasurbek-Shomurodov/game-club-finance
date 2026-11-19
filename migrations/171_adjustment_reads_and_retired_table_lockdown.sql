-- Read paths for the month views and the last two writable retired tables.
-- Additive: no ledger row is changed and no function body is replaced.

-- 1. Stock adjustments by period ------------------------------------------------
-- The Bar "Write-offs and corrections" month view, the Reports write-offs tab
-- and the Owner Profit write-offs section all read a club's counts for a date
-- range "where adjustment_quantity <> 0" (older builds: "< 0"). Only a few
-- counts in a thousand carry an adjustment, so without this the planner walks
-- every count of the month through idx_stock_counts_club_date and discards
-- almost all of them. A plain "<> 0" predicate serves "< 0" and "> 0" too.
create index if not exists idx_stock_counts_club_date_adjusted
  on public.daily_stock_counts (club_id, date)
  where adjustment_quantity <> 0;

comment on index public.idx_stock_counts_club_date_adjusted is
  'Counts that carry a write-off or correction, for the period views that list only those.';

-- 2. One person's salary and shortage history -----------------------------------
-- The employee page and the shortage-to-salary link filter by employee inside a
-- club; salary_entries_club (club_id, date) made them scan every employee's
-- entries.
create index if not exists idx_salary_entries_club_employee_date
  on public.salary_entries (club_id, employee_id, date);

create index if not exists idx_cash_shortages_club_employee
  on public.cash_shortages (club_id, employee_id)
  where employee_id is not null;

-- 3. Retired tables are read-only -----------------------------------------------
-- 036 made cash_movements, income_transactions and expense_transactions
-- read-only but left the other two retired tables writable: an admin could
-- still insert into the pre-ledger `debts` table (and an owner delete from it)
-- through the 014 policies, creating records no screen or report reads.
-- `balances` was only ever written by triggers on the tables 036 froze.
-- Historical rows stay readable through their select policies.
drop policy if exists "club_admin_write_legacy_debts" on public.debts;
drop policy if exists "club_owner_delete_legacy_debts" on public.debts;

revoke insert, update, delete, truncate, references, trigger
  on table public.debts, public.balances
  from PUBLIC, anon, authenticated;

comment on table public.debts is
  'Retired legacy ledger. Historical rows are read-only; use new_debts and debt_payments for new records.';
comment on table public.balances is
  'Retired legacy running balances. Read-only; current balances are derived from the finance ledgers.';
