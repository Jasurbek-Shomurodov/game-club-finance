-- Move the days collected before 137 into the owner reserve.
--
-- 137 deposits a day's Game Club money into the reserve when the day is ticked
-- as collected, but did not back-fill the days ticked before it. This gives
-- every collected day that has no collection deposit yet the deposits 137 would
-- have made, oldest day first, using the same rule: per payment method, the
-- day's money, capped at what that month still has for the method after
-- withdrawals, carryovers and the earlier days' deposits. A method with nothing
-- left deposits nothing. The deposit is credited to whoever ticked the day.
--
-- Undoing one of these collections removes its deposits, as in 137. Re-runnable:
-- a day that already has a collection deposit is skipped.

-- A collected day has at most one deposit per payment method.
create unique index if not exists owner_reserve_entries_collection_method
  on public.owner_reserve_entries(club_id, collection_date, payment_method) where collection_date is not null;

do $$
declare
  day record;
  method text;
  month_start date;
  amount numeric;
begin
  for day in
    select dc.club_id, dc.date, dc.collected_by
    from public.daily_cash_collections dc
    where not exists (
      select 1 from public.owner_reserve_entries e
      where e.club_id = dc.club_id and e.collection_date = dc.date
    )
    order by dc.club_id, dc.date
  loop
    month_start := date_trunc('month', day.date)::date;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      day.club_id::text || ':game_club:' || month_start::text, 0));
    foreach method in array array['cash', 'terminal', 'card', 'playstation'] loop
      amount := floor(least(
        public.collection_day_method_money(day.club_id, method, day.date),
        public.owner_profit_bucket_available(day.club_id, 'game_club', method, month_start)
      ));
      if amount > 0 then
        insert into public.owner_reserve_entries
          (id, club_id, kind, period_month, source, payment_method, amount, comment, created_by, collection_date)
          values (gen_random_uuid(), day.club_id, 'deposit', month_start, 'game_club', method, amount, null,
                  day.collected_by, day.date);
      end if;
    end loop;
  end loop;
end;
$$;
