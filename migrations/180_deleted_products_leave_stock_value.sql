-- Deleted products leave count-based stock value from the day they are deleted.
--
-- Deleting a product zeroes its stock without a new count (055), so its last
-- saved count can still hold units. Stock value built from the latest count
-- per product (the dashboard's month-end value and last-month comparison)
-- kept counting those units. get_dashboard_snapshot (156) now returns each
-- inventory row's product deleted_at, and the app leaves a product out from
-- its deletion date on. Saved counts, sales and purchases are not touched.
--
-- The body is otherwise unchanged. Older clients ignore the new key; a client
-- without this migration reads no deleted_at and values stock as before.
-- Re-runnable; grants of the replaced function are kept.

create or replace function public.get_dashboard_snapshot(p_club_id uuid, p_range_from date, p_range_to date, p_previous_from date, p_previous_to date, p_inventory_from date, p_inventory_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_finance_from date := least(p_range_from, p_previous_from);
  v_finance_to date := greatest(p_range_to, p_previous_to);
begin
  if auth.uid() is null or not public.user_has_club_access(p_club_id) then
    raise exception 'Not authorized for this club.';
  end if;

  return jsonb_build_object(
    'cashRows', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.created_at)
      from (
        select date, cash_income, terminal_income, card_income, playstation_income, created_at
        from public.daily_cash_entries
        where club_id = p_club_id and date between v_finance_from and v_finance_to
      ) rows
    ), '[]'::jsonb),
    'stockRows', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date)
      from (
        select
          date,
          sum(bar_income) as bar_income,
          sum(bar_profit) as bar_profit,
          sum(bar_cost) as bar_cost,
          sum(sold_quantity) as sold_quantity,
          max(updated_at) as updated_at
        from public.daily_stock_counts
        where club_id = p_club_id and date between v_finance_from and v_finance_to
        group by date
      ) rows
    ), '[]'::jsonb),
    'inventoryRows', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.product_id)
      from (
        select distinct on (candidates.interval_key, candidates.product_id)
          candidates.product_id,
          candidates.date,
          candidates.closing_stock,
          candidates.cost_price,
          candidates.products
        from (
          select
            'current'::text as interval_key,
            counts.product_id,
            counts.date,
            counts.closing_stock,
            counts.cost_price,
            counts.updated_at,
            jsonb_build_object('tracks_inventory', products.tracks_inventory, 'deleted_at', products.deleted_at) as products
          from public.daily_stock_counts counts
          left join public.products products on products.id = counts.product_id
          where counts.club_id = p_club_id
            and counts.date between p_range_from and p_range_to

          union all

          select
            'comparison'::text as interval_key,
            counts.product_id,
            counts.date,
            counts.closing_stock,
            counts.cost_price,
            counts.updated_at,
            jsonb_build_object('tracks_inventory', products.tracks_inventory, 'deleted_at', products.deleted_at) as products
          from public.daily_stock_counts counts
          left join public.products products on products.id = counts.product_id
          where counts.club_id = p_club_id
            and counts.date between p_inventory_from and p_inventory_to
        ) candidates
        order by candidates.interval_key, candidates.product_id, candidates.date desc, candidates.updated_at desc
      ) rows
    ), '[]'::jsonb),
    'purchaseRows', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select id, date, quantity, cost_price, comment, created_at
        from public.stock_purchases
        where club_id = p_club_id and date between v_finance_from and v_finance_to
      ) rows
    ), '[]'::jsonb),
    'expenseRows', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select id, date, amount, category, payment_method, payment_source, comment, created_at, paid_from_reserve
        from public.expenses
        where club_id = p_club_id and date between v_finance_from and v_finance_to
      ) rows
    ), '[]'::jsonb),
    'debtRows', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select id, person_name, date, amount, remaining_amount, status
        from public.new_debts
        where club_id = p_club_id
          and (status <> 'paid' or date between v_finance_from and v_finance_to)
      ) rows
    ), '[]'::jsonb),
    'debtPaymentRows', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select id, date, amount, payment_method
        from public.debt_payments
        where club_id = p_club_id and date between v_finance_from and v_finance_to
      ) rows
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.sort_order nulls last, rows.name, rows.id)
      from (
        select id, name, current_stock, cost_price, tracks_inventory, low_stock_threshold, sort_order
        from public.products
        where club_id = p_club_id and is_active = true
      ) rows
    ), '[]'::jsonb)
  );
end;
$function$;
