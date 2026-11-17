-- Lower read load on the busiest screens and add the per-product bar sales
-- read behind the Products page. No ledger row is changed.

-- 1. Reserve and dollar expenses -----------------------------------------------
-- owner_reserve_balance, owner_reserve_month_effect (143), guard_reserve_expense
-- (136) and the Money taken page all filter a club's expenses by
-- "paid_from_reserve or payment_method = 'usd'". The 136 partial index covered
-- only the first half, so each call walked the club's whole expense history
-- (get_owner_reserve_balances does it eight times). This index matches the
-- predicate exactly, and "payment_method = 'usd'" alone implies it.
create index if not exists idx_expenses_club_reserve_or_usd
  on public.expenses (club_id, date)
  where (paid_from_reserve or payment_method = 'usd');
-- Its only readers now use the index above.
drop index if exists public.expenses_paid_from_reserve;

-- 2. Opening stock: one index probe per product ---------------------------------
-- 057 found each product's latest closing with DISTINCT ON over every stock
-- count the club ever saved, the largest table. A club has a few dozen
-- products, so probe idx_stock_counts_club_product_date_desc once per product
-- instead. Same rows: a count's club always equals its product's club
-- (trg_stock_count_product_club), and (club_id, date, product_id) is unique,
-- so "latest" has no ties.
create or replace function public.get_stock_opening_balances(
  p_club_id uuid,
  p_before_date date
)
returns table (product_id uuid, previous_stock numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with latest as (
    select products.id as product_id, last_count.date, last_count.closing_stock
    from public.products products
    cross join lateral (
      select counts.date, counts.closing_stock
      from public.daily_stock_counts counts
      where counts.club_id = p_club_id
        and counts.product_id = products.id
        and counts.date < p_before_date
      order by counts.date desc
      limit 1
    ) last_count
    where products.club_id = p_club_id
  ), receipts as (
    select purchases.product_id, sum(purchases.quantity) as quantity
    from public.stock_purchases purchases
    left join latest on latest.product_id = purchases.product_id
    where purchases.club_id = p_club_id
      and purchases.date < p_before_date
      and (latest.date is null or purchases.date > latest.date)
      and (latest.date is not null or p_before_date < public.club_business_date(p_club_id))
    group by purchases.product_id
  )
  select coalesce(latest.product_id, receipts.product_id),
    coalesce(latest.closing_stock, 0) + coalesce(receipts.quantity, 0)
  from latest full join receipts on receipts.product_id = latest.product_id;
$$;

revoke all on function public.get_stock_opening_balances(uuid, date) from public, anon;
grant execute on function public.get_stock_opening_balances(uuid, date) to authenticated;

-- 3. Owner-only reads: resolve membership once per statement --------------------
-- Both policies called current_user_club_role(club_id) for every row, the
-- pattern 054 and 081 removed from the other ledgers. The audit log only grows.
alter policy entry_audit_logs_owner_read on public.entry_audit_logs
  using (club_id in (select public.current_user_member_clubs(array['owner']::text[])));
alter policy cash_shortages_owner_read on public.cash_shortages
  using (club_id in (select public.current_user_member_clubs(array['owner']::text[])));

-- 4. Deleting a promotion ---------------------------------------------------------
-- daily_stock_counts.promotion_id is "on delete set null" with no index, so
-- each promotion delete scanned every stock count.
create index if not exists idx_stock_counts_promotion
  on public.daily_stock_counts (promotion_id)
  where promotion_id is not null;

-- 5. Indexes no query can use ----------------------------------------------------
-- Both predate clubs: every product read filters club_id first.
drop index if exists public.idx_products_sort_order;
drop index if exists public.idx_products_not_deleted;
-- A prefix of the unique owner_reserve_entries_collection_method (139).
drop index if exists public.owner_reserve_entries_collection;

-- 6. Team badge -------------------------------------------------------------------
-- The sidebar counted open access requests by downloading every readable
-- profile and membership. Count them here instead. SECURITY INVOKER: the
-- caller's own RLS decides which profiles and memberships are seen, exactly
-- as it did for the two table reads this replaces.
create or replace function public.count_pending_access_requests()
returns integer
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from public.profiles profile
  where profile.access_rejected_at is null
    and not exists (
      select 1 from public.club_memberships membership
      where membership.user_id = profile.id
    );
$$;

revoke all on function public.count_pending_access_requests() from public, anon;
grant execute on function public.count_pending_access_requests() to authenticated;

-- 7. Bar sales per product --------------------------------------------------------
-- What each product sold between two business dates, summed in the database
-- (one row per product instead of one per product per day). SECURITY INVOKER:
-- the stock-count read policy applies, so a member who cannot read stock
-- counts gets no rows.
create or replace function public.get_bar_product_sales(
  p_club_id uuid,
  p_from date,
  p_to date
)
returns table (
  product_id uuid,
  sold_quantity numeric,
  bar_income numeric,
  bar_cost numeric,
  days_counted integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select counts.product_id,
    coalesce(sum(counts.sold_quantity), 0),
    coalesce(sum(counts.bar_income), 0),
    coalesce(sum(counts.bar_cost), 0),
    count(distinct counts.date)::integer
  from public.daily_stock_counts counts
  where counts.club_id = p_club_id
    and counts.date between p_from and p_to
  group by counts.product_id;
$$;

revoke all on function public.get_bar_product_sales(uuid, date, date) from public, anon;
grant execute on function public.get_bar_product_sales(uuid, date, date) to authenticated;
