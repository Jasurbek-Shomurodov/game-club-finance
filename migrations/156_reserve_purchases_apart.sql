-- Purchases the owner reserve (jamg'arma) paid are told apart everywhere.
--
-- A reserve purchase (paid_from_reserve, 136/155) or a dollar expense (143) is
-- still an expense, so it stays in expense totals and accounting profit, but
-- the reserve paid for it: it never takes money out of a month's Game Club or
-- Bar money, or out of a payment method's balance (as expense_method_balance
-- already does).
--
--   get_money_report_snapshot (081), get_dashboard_snapshot (035) and
--   get_finance_report_snapshot (049) now return each expense's
--   paid_from_reserve, so Reports, the Dashboard, Financial Analysis and the
--   daily Telegram report can leave such purchases out of money left.
--   Bodies are unchanged otherwise.
--   get_salary_profit_snapshot (154) returns what the reserve paid each month
--   (game_club_reserve_paid, bar_reserve_paid), investments aside since they
--   are added back already, so the profit-before-payroll KPI base is the
--   month's Owner Profit, as on the Owner Profit page, and a reserve purchase
--   no longer lowers it. Repairs and discounts still lower the daily income
--   KPI whoever paid them.
--
-- Re-runnable; grants of the replaced functions are kept.

create or replace function public.get_money_report_snapshot(p_club_id uuid, p_range_from date, p_range_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
          expenses.created_by, expenses.created_at, expenses.paid_from_reserve,
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
$function$;

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
            jsonb_build_object('tracks_inventory', products.tracks_inventory) as products
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
            jsonb_build_object('tracks_inventory', products.tracks_inventory) as products
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

create or replace function public.get_finance_report_snapshot(p_club_id uuid, p_range_from date, p_range_to date, p_sections text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_sections text[] := coalesce(p_sections, '{}'::text[]);
begin
  if p_range_from > p_range_to then
    raise exception 'Invalid report date range.';
  end if;

  if exists (
    select 1
    from unnest(v_sections) requested(section_name)
    where not requested.section_name = any(array[
      'cash', 'stock_totals', 'stock_counts', 'purchases', 'expenses',
      'debts', 'debt_payments'
    ]::text[])
  ) then
    raise exception 'Invalid finance report section.';
  end if;

  if auth.uid() is null
    or not public.current_user_can_access_club_feature_any(
      p_club_id,
      array['dashboard', 'reports']::text[]
    ) then
    raise exception 'Not authorized for this club report.';
  end if;

  return jsonb_build_object(
    'cashRows', case when 'cash' = any(v_sections) then coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.created_at)
      from (
        select entries.id, entries.club_id, entries.date,
          entries.cash_income, entries.terminal_income, entries.card_income,
          entries.playstation_income, entries.comment, entries.created_by,
          entries.created_at, entries.updated_at
        from public.daily_cash_entries entries
        where entries.club_id = p_club_id
          and entries.date between p_range_from and p_range_to
      ) rows
    ), '[]'::jsonb) else '[]'::jsonb end,
    'stockTotalRows', case when 'stock_totals' = any(v_sections) then coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date)
      from (
        select counts.date,
          sum(counts.bar_income) as bar_income,
          sum(counts.bar_cost) as bar_cost
        from public.daily_stock_counts counts
        where counts.club_id = p_club_id
          and counts.date between p_range_from and p_range_to
        group by counts.date
      ) rows
    ), '[]'::jsonb) else '[]'::jsonb end,
    'stockCountRows', case when 'stock_counts' = any(v_sections) then coalesce((
      select jsonb_agg(
        to_jsonb(rows)
        order by rows.sort_order nulls last, rows.product_name, rows.product_id
      )
      from (
        select counts.id, counts.club_id, counts.date, counts.product_id,
          counts.previous_stock, counts.added_today, counts.closing_stock,
          counts.sold_quantity, counts.sale_price, counts.cost_price,
          counts.bar_income, counts.bar_cost, counts.bar_profit,
          counts.created_by, counts.created_at, counts.updated_at,
          products.name as product_name,
          products.sort_order
        from public.daily_stock_counts counts
        left join public.products products on products.id = counts.product_id
        where counts.club_id = p_club_id
          and counts.date between p_range_from and p_range_to
      ) rows
    ), '[]'::jsonb) else '[]'::jsonb end,
    'purchaseRows', case when 'purchases' = any(v_sections) then coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select purchases.id, purchases.club_id, purchases.date,
          purchases.product_id, purchases.quantity, purchases.cost_price,
          purchases.sale_price, purchases.payment_method, purchases.comment,
          purchases.created_by, purchases.created_at,
          products.name as product_name
        from public.stock_purchases purchases
        left join public.products products on products.id = purchases.product_id
        where purchases.club_id = p_club_id
          and purchases.date between p_range_from and p_range_to
      ) rows
    ), '[]'::jsonb) else '[]'::jsonb end,
    'expenseRows', case when 'expenses' = any(v_sections) then coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select expenses.id, expenses.club_id, expenses.date, expenses.amount,
          expenses.payment_method, expenses.payment_source, expenses.category,
          expenses.comment, expenses.telegram_chat_id,
          expenses.telegram_message_id, expenses.created_by,
          expenses.created_at, expenses.updated_at, expenses.paid_from_reserve
        from public.expenses expenses
        where expenses.club_id = p_club_id
          and expenses.date between p_range_from and p_range_to
      ) rows
    ), '[]'::jsonb) else '[]'::jsonb end,
    'debtRows', case when 'debts' = any(v_sections) then coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select debts.id, debts.date, debts.amount
        from public.new_debts debts
        where debts.club_id = p_club_id
          and debts.date between p_range_from and p_range_to
      ) rows
    ), '[]'::jsonb) else '[]'::jsonb end,
    'debtPaymentRows', case when 'debt_payments' = any(v_sections) then coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select payments.id, payments.date, payments.amount,
          payments.payment_method
        from public.debt_payments payments
        where payments.club_id = p_club_id
          and payments.date between p_range_from and p_range_to
      ) rows
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$function$;

create or replace function public.get_salary_profit_snapshot(p_club_id uuid, p_through_date date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is null then
    raise exception 'Not authorized for this club payroll.' using errcode = '42501';
  end if;
  if p_through_date is null or p_through_date > public.club_business_date(p_club_id) then
    raise exception 'Invalid payroll date.';
  end if;
  return jsonb_build_object('monthlyBalances', coalesce((
    select jsonb_agg(jsonb_build_object(
      'period_month', row->'period_month',
      'game_club_earned', row->'game_club_earned',
      'bar_earned', row->'bar_earned',
      'game_club_withdrawn', row->'game_club_withdrawn',
      'bar_withdrawn', row->'bar_withdrawn',
      'game_club_investments', coalesce(investments.game_club, 0),
      'bar_investments', coalesce(investments.bar, 0),
      -- 156: what the reserve paid that month, investments aside (already above).
      'game_club_reserve_paid', coalesce(investments.game_club_reserve, 0),
      'bar_reserve_paid', coalesce(investments.bar_reserve, 0)
    ))
    from jsonb_array_elements(public.get_owner_profit_snapshot(p_club_id, p_through_date)->'monthlyBalances') row
    left join (
      select date_trunc('month', expenses.date)::date as period_month,
        sum(expenses.amount) filter (where expenses.category = 'investments' and expenses.payment_source = 'game_club') as game_club,
        sum(expenses.amount) filter (where expenses.category = 'investments' and expenses.payment_source = 'bar') as bar,
        sum(expenses.amount) filter (where expenses.category <> 'investments'
          and (expenses.paid_from_reserve or expenses.payment_method = 'usd')
          and coalesce(expenses.payment_source, 'game_club') = 'game_club') as game_club_reserve,
        sum(expenses.amount) filter (where expenses.category <> 'investments'
          and expenses.paid_from_reserve and expenses.payment_source = 'bar') as bar_reserve
      from public.expenses expenses
      where expenses.club_id = p_club_id and expenses.date <= p_through_date
        and (expenses.category = 'investments' or expenses.paid_from_reserve or expenses.payment_method = 'usd')
      group by 1
    ) investments on investments.period_month = (row->>'period_month')::date
  ), '[]'::jsonb),
  'dailyGameClubIncome', coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', coalesce(income.date, discounts.date),
      'amount', coalesce(income.amount, 0) - coalesce(discounts.amount, 0)
    ) order by coalesce(income.date, discounts.date))
    from (
      select entries.date,
        entries.cash_income + entries.terminal_income + entries.card_income + entries.playstation_income as amount
      from public.daily_cash_entries entries
      where entries.club_id = p_club_id and entries.date <= p_through_date
    ) income
    full join (
      select expenses.date, sum(expenses.amount) as amount
      from public.expenses expenses
      where expenses.club_id = p_club_id and expenses.date <= p_through_date
        and expenses.category in ('discount', 'repair') and expenses.payment_source = 'game_club'
      group by expenses.date
    ) discounts on discounts.date = income.date
  ), '[]'::jsonb));
end;
$function$;

-- Money moved into the reserve (positive) or out of it (negative) between two
-- dates, for screens that keep the reserve out of a side's money left:
-- deposits and returns (136) on the business day they were made, kept inside
-- the profit month they belong to as expense_method_balance counts them, and
-- dollar exchanges (143) on their date. Purchases are not here: they carry
-- paid_from_reserve. Any club member may read the amounts (admins see the
-- totals move, as they see money left), never the entries themselves; the
-- service role (Telegram report) may read every club.
create or replace function public.get_reserve_moves(p_club_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and public.current_user_club_role(p_club_id) is null then
    raise exception 'Not authorized for this club.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('date', moves.date, 'source', moves.source, 'method', moves.method, 'amount', moves.amount)
      order by moves.date)
    from (
      select greatest(entries.period_month,
          least(public.club_business_date(entries.club_id, entries.created_at),
            (entries.period_month + interval '1 month' - interval '1 day')::date)) as date,
        entries.source, entries.payment_method as method,
        case entries.kind when 'deposit' then entries.amount else -entries.amount end as amount
      from public.owner_reserve_entries entries
      where entries.club_id = p_club_id
      union all
      select exchanges.date, 'game_club', 'usd',
        case when exchanges.to_method = 'usd' then exchanges.from_amount else -exchanges.to_amount end
      from public.money_exchanges exchanges
      where exchanges.club_id = p_club_id and 'usd' in (exchanges.from_method, exchanges.to_method)
    ) moves
    where moves.date between p_from and p_to
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_reserve_moves(uuid, date, date) from public, anon;
grant execute on function public.get_reserve_moves(uuid, date, date) to authenticated, service_role;
