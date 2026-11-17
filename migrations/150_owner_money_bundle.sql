-- Owner Profit opened with seven requests: the profit snapshot, carryovers,
-- investments, exchanges, dollar expenses, reserve entries and reserve
-- purchases. The tables are small, so the wait is the round trips, not the
-- work. This returns the same rows in one call.
--
-- Security invoker: every read below runs under the caller's row level
-- security exactly as the separate table reads did, and the snapshot raises
-- for someone who is not a member of the club. Each list holds the columns
-- and the order the application's own reads ask for, so the application
-- builds its balances from this payload with the code it already had.
create or replace function public.get_owner_money_bundle(
  p_club_id uuid,
  p_through_date date
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'snapshot', public.get_owner_profit_snapshot_with_methods(p_club_id, p_through_date),
    'carryovers', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.id)
      from (
        select id, club_id, from_month, to_month, source, payment_method, amount, comment, created_by, created_at
        from public.owner_profit_carryovers
        where club_id = p_club_id
          and from_month <= date_trunc('month', p_through_date)::date
      ) rows
    ), '[]'::jsonb),
    'investments', coalesce((
      select jsonb_agg(jsonb_build_object('date', rows.date, 'amount', rows.amount, 'payment_source', rows.payment_source) order by rows.id)
      from public.expenses rows
      where rows.club_id = p_club_id
        and rows.category = 'investments'
        and rows.date <= p_through_date
    ), '[]'::jsonb),
    'exchanges', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select id, date, from_method, to_method, from_amount, to_amount, rate, comment, created_by, created_at
        from public.money_exchanges
        where club_id = p_club_id
          and date <= p_through_date
      ) rows
    ), '[]'::jsonb),
    'dollarExpenses', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.date, rows.id)
      from (
        select id, date, amount, payment_method, usd_amount, usd_rate
        from public.expenses
        where club_id = p_club_id
          and payment_method = 'usd'
          and date <= p_through_date
      ) rows
    ), '[]'::jsonb),
    'reserveEntries', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.id)
      from (
        select id, club_id, kind, period_month, source, payment_method, amount, comment, collection_date, created_by, created_at
        from public.owner_reserve_entries
        where club_id = p_club_id
      ) rows
    ), '[]'::jsonb),
    'reserveExpenses', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.id)
      from (
        select id, date, amount, payment_source, payment_method, category, comment, created_at
        from public.expenses
        where club_id = p_club_id
          and (paid_from_reserve is true or payment_method = 'usd')
      ) rows
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_owner_money_bundle(uuid, date) from public, anon;
grant execute on function public.get_owner_money_bundle(uuid, date) to authenticated;
