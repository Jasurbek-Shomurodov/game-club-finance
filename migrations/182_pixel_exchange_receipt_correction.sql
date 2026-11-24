-- Pixel Gaming's exchange of terminal money into dollars on 31 October 2026,
-- corrected once by 181, is corrected again from the bank receipt. The receipt
-- shows 365 dollars bought at 11 935 sums per dollar, 4 356 275 sums paid
-- (4 356 275 / 365 = 11 935 exactly):
--   from_amount  4 380 000.00 -> 4 356 275.00
--   to_amount          363.94 ->       365.00
--   rate            12 035.00 ->    11 935.00
-- The receipt is dated 4 November; the entry deliberately keeps 31 October,
-- the date the owner chose. Methods (terminal -> usd) and the comment are
-- unchanged. No reserve entry is paired with this exchange (170), so nothing
-- else stores its sums.
--
-- DESTRUCTIVE: updates one existing money_exchanges row in place (from_amount,
-- to_amount and rate). The row as it was is kept by the record_entry_audit
-- trigger (111) in entry_audit_logs, with no user (changed_by is null).
--
-- No trigger is disabled. A plain update passes every one on this table:
-- lock_collected_day (097) because 31 October is not a collected day;
-- record_entry_audit (111) logs it with auth.uid() null; the balance (144),
-- never-negative (146) and note (108/163) triggers fire on insert or delete
-- only. Because 146 is skipped, the migration itself checks that the club's
-- dollars and its terminal money still stand at or above zero on every day
-- since (both only rise here: 1.06 dollars more, 23 725 sums of terminal money
-- back), and stops without changing anything if they do not.
--
-- The update matches the row's id, club and its 181 values only. A second
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
    and exchange.from_method = 'terminal' and exchange.to_method = 'usd' then
    if exchange.from_amount = 4356275.00 and exchange.to_amount = 365.00
      and exchange.rate = 11935.00 then
      return; -- Already corrected.
    end if;
    if exchange.from_amount = 4380000.00 and exchange.to_amount = 363.94
      and exchange.rate = 12035.00 then
      -- A reserve entry paired with the exchange (170) stores the same sums.
      if exists (select 1 from public.owner_reserve_entries
                 where club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
                   and paired_exchange_id = 'f07c58e8-4521-4a93-8ae4-ea7a20cabf01') then
        raise exception 'Exchange f07c58e8 is paired with a reserve entry; correct both together.';
      end if;
      update public.money_exchanges
      set from_amount = 4356275.00,
          to_amount = 365.00,
          rate = 11935.00
      where id = 'f07c58e8-4521-4a93-8ae4-ea7a20cabf01'
        and club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
        and from_amount = 4380000.00
        and to_amount = 363.94
        and rate = 12035.00;
      -- The never-negative trigger (146) does not fire on update, so check here
      -- that the club's dollars and terminal money still cover everything spent
      -- since that day.
      if coalesce(public.method_daily_lowest_balance(
        '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305', 'usd', date '2026-10-31'), 0) < 0 then
        raise exception 'Correcting exchange f07c58e8 would leave the club''s dollars negative; not changed.';
      end if;
      if coalesce(public.method_daily_lowest_balance(
        '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305', 'terminal', date '2026-10-31'), 0) < 0 then
        raise exception 'Correcting exchange f07c58e8 would leave the club''s terminal money negative; not changed.';
      end if;
      return;
    end if;
  end if;

  raise exception 'Exchange f07c58e8 is neither at the 181 values nor corrected (date %, % -> %, from %, to %, rate %); not changed.',
    exchange.date, exchange.from_method, exchange.to_method,
    exchange.from_amount, exchange.to_amount, exchange.rate;
end;
$$;
