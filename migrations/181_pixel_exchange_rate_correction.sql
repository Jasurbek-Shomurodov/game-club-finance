-- Pixel Gaming's exchange of terminal money into dollars on 31 October 2026
-- was entered at 11 035 sums per dollar instead of 12 035. The 4 380 000 sums
-- paid were right; the rate, and the dollars worked out from it, were not:
--   rate       11 035.00 -> 12 035.00
--   to_amount     396.92 ->    363.94  (4 380 000 / 12 035, rounded to cents
--                                       as record_money_exchange does, 092)
-- The sums side (from_amount) is unchanged, so a reserve entry paired with
-- this exchange (170) still matches it.
--
-- DESTRUCTIVE: updates one existing money_exchanges row in place (rate and
-- to_amount). The row as it was is kept by the record_entry_audit trigger
-- (111) in entry_audit_logs, with no user (changed_by is null).
--
-- No trigger is disabled. A plain update passes every one on this table:
-- lock_collected_day (097) because 31 October is not a collected day;
-- record_entry_audit (111) logs it with auth.uid() null; the balance (144),
-- never-negative (146) and note (108/163) triggers fire on insert or delete
-- only. Because 146 is skipped, the migration itself checks that the 32.98
-- fewer dollars still leave the club's dollar balance at or above zero on
-- every day since, and stops without changing anything if they do not.
--
-- The update matches the row's id, club and its wrong values only. A second
-- run, a run after the row was corrected, and a database without this row
-- (local, tests) change nothing; a row found in any other state stops the
-- migration instead of being overwritten. Re-runnable.

do $$
declare
  exchange public.money_exchanges;
begin
  select * into exchange
  from public.money_exchanges
  where id = 'f07c58e8-4521-4a93-8ae4-ea7a20cabf01'
    and club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  for update;

  if not found then
    raise notice 'Exchange f07c58e8 is not in this database; nothing to correct.';
    return;
  end if;

  if exchange.date = date '2026-10-31'
    and exchange.from_method = 'terminal' and exchange.to_method = 'usd'
    and exchange.from_amount = 4380000.00 then
    if exchange.rate = 12035.00 and exchange.to_amount = 363.94 then
      return; -- Already corrected.
    end if;
    if exchange.rate = 11035.00 and exchange.to_amount = 396.92 then
      update public.money_exchanges
      set rate = 12035.00,
          to_amount = 363.94
      where id = 'f07c58e8-4521-4a93-8ae4-ea7a20cabf01'
        and club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
        and rate = 11035.00
        and to_amount = 396.92;
      -- The never-negative trigger (146) does not fire on update, so check here
      -- that the club's dollars still cover everything spent since that day.
      if coalesce(public.method_daily_lowest_balance(
        '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305', 'usd', date '2026-10-31'), 0) < 0 then
        raise exception 'Correcting exchange f07c58e8 would leave the club''s dollars negative; not changed.';
      end if;
      return;
    end if;
  end if;

  raise exception 'Exchange f07c58e8 is neither at the wrong rate nor corrected (date %, % -> %, from %, to %, rate %); not changed.',
    exchange.date, exchange.from_method, exchange.to_method,
    exchange.from_amount, exchange.to_amount, exchange.rate;
end;
$$;
