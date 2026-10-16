-- Cost and index cleanup from the October 2026 database review.
-- No ledger rows, financial formulas or visible permissions change.
--
-- 1. Payroll read policies evaluate membership once per statement instead of
--    calling a security-definer function for every row (the 054 pattern).
-- 2. The leftover FOR ALL policy on stock_purchases (014) is replaced by a
--    SELECT policy with the same visibility; writes already go through RPCs.
-- 3. Indexes for the debt-payment history and the purchase receipt list;
--    three indexes that duplicate unique constraints are dropped.
-- 4. UTC calendar-date defaults on the debt ledgers are removed: the app
--    always sends the club's business date.
-- 5. The unused monthly average income snapshot (042/043) and the legacy
--    balances seed trigger (014) are retired.
-- 6. get_money_report_snapshot returns bar sales per day instead of per
--    product per day.

-- 1. Payroll reads --------------------------------------------------------

-- Clubs the caller belongs to, optionally limited to some roles. Evaluated
-- once per statement; policies keep the subquery uncorrelated.
create or replace function public.current_user_member_clubs(p_roles text[] default null)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select membership.club_id
  from public.club_memberships membership
  where membership.user_id = (select auth.uid())
    and (p_roles is null or membership.role::text = any (p_roles));
$$;

revoke all on function public.current_user_member_clubs(text[]) from public, anon;
grant execute on function public.current_user_member_clubs(text[]) to authenticated;

alter policy salary_employees_member_read on public.salary_employees
  using (club_id in (select public.current_user_member_clubs()));
alter policy salary_rates_member_read on public.salary_rates
  using (club_id in (select public.current_user_member_clubs()));
alter policy salary_entries_member_read on public.salary_entries
  using (club_id in (select public.current_user_member_clubs()));

-- 2. Stock purchases: keep the admin/owner visibility union of 014 ------------

drop policy if exists "club_admin_write_stock_purchases" on public.stock_purchases;
create policy "club_role_read_stock_purchases" on public.stock_purchases
  for select to authenticated
  using (club_id in (select public.current_user_member_clubs(array['admin', 'owner']::text[])));

-- 3. Indexes -----------------------------------------------------------------

-- Payment history of one debt (Debts page) and the per-debt triggers.
create index if not exists idx_debt_payments_club_debt_date
  on public.debt_payments (club_id, debt_id, date desc, created_at desc);

-- Receipt list, newest first (Stock purchase page).
create index if not exists idx_stock_purchases_club_created_at
  on public.stock_purchases (club_id, created_at desc, id desc);

-- Covered by daily_cash_entries_club_date_key (club_id, date).
drop index if exists public.idx_cash_entries_club_date;
-- Covered by daily_stock_counts_club_date_product_key (club_id, date, product_id).
drop index if exists public.idx_stock_counts_club_date;
-- Pre-multi-club uniqueness; implied by the club-scoped key above.
alter table public.daily_stock_counts
  drop constraint if exists daily_stock_counts_date_product_id_key;

-- 4. Business dates come from the application --------------------------------

alter table public.new_debts alter column date drop default;
alter table public.debt_payments alter column date drop default;

-- 5. Retired objects ---------------------------------------------------------

do $$
declare
  existing_job_id bigint;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  for existing_job_id in
    select jobid from cron.job where jobname = 'finalize-monthly-average-income'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;
end;
$$;

drop function if exists public.get_monthly_average_income_chart(uuid, date);
drop function if exists public.refresh_monthly_average_income_snapshot(date);
drop table if exists public.monthly_average_income_snapshots;

drop trigger if exists trg_seed_balances_for_club on public.clubs;

-- 6. Bar sales per day in the money report -----------------------------------

create or replace function public.get_money_report_snapshot(
  p_club_id uuid,
  p_range_from date,
  p_range_to date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_range_from > p_range_to then
    raise exception 'Invalid report date range.';
  end if;

  if auth.uid() is null
    or not public.current_user_can_access_club_feature(p_club_id, 'reports') then
    raise exception 'Not authorized for this club report.';
  end if;

  return jsonb_build_object(
    'cash', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.created_at)
      from (
        select entries.id, entries.date, entries.cash_income,
          entries.terminal_income, entries.card_income,
          entries.playstation_income, entries.comment, entries.created_by,
          entries.created_at, profiles.full_name as creator_name
        from public.daily_cash_entries entries
        left join public.profiles profiles on profiles.id = entries.created_by
        where entries.club_id = p_club_id
          and entries.date between p_range_from and p_range_to
      ) rows
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select expenses.id, expenses.date, expenses.amount, expenses.category,
          expenses.payment_method, expenses.payment_source, expenses.comment,
          expenses.created_by, expenses.created_at,
          profiles.full_name as creator_name
        from public.expenses expenses
        left join public.profiles profiles on profiles.id = expenses.created_by
        where expenses.club_id = p_club_id
          and expenses.date between p_range_from and p_range_to
      ) rows
    ), '[]'::jsonb),
    'debtPayments', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select payments.id, payments.date, payments.amount,
          payments.payment_method, payments.comment, payments.created_at
        from public.debt_payments payments
        where payments.club_id = p_club_id
          and payments.date between p_range_from and p_range_to
      ) rows
    ), '[]'::jsonb),
    -- One row per day: the client only sums bar income by date.
    'barSales', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date)
      from (
        select counts.date, sum(coalesce(counts.bar_income, 0)) as bar_income
        from public.daily_stock_counts counts
        where counts.club_id = p_club_id
          and counts.date between p_range_from and p_range_to
        group by counts.date
      ) rows
    ), '[]'::jsonb),
    'stockPurchases', coalesce((
      select jsonb_agg(to_jsonb(rows))
      from (
        select purchases.date, purchases.quantity, purchases.cost_price
        from public.stock_purchases purchases
        where purchases.club_id = p_club_id
          and purchases.date between p_range_from and p_range_to
      ) rows
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_money_report_snapshot(uuid, date, date)
  from public, anon;
grant execute on function public.get_money_report_snapshot(uuid, date, date)
  to authenticated;
