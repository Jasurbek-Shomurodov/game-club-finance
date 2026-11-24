-- Pixel Gaming's two dollar expenses, booked before 184 at a typed rate of
-- 12 000 sums per dollar, are repriced at what their dollars cost
-- (docs/plans/dollar-account-expenses.md, slice 2), exactly as 184's
-- price_dollar_expense would have priced them in date order.
--
-- The dollars: two exchanges on 31 October 2026, terminal -> usd, and no
-- dollars sold:
--   16 863 000.00 sums for 1 400.00 dollars
--    4 356 275.00 sums for   365.00 dollars (the receipt, 182)
--   21 219 275.00 sums for 1 765.00 dollars
--
-- 1. 2026-10-31 rent, $1 250 (2d1e9e57): cost of a dollar before it
--      21 219 275 / 1 765 = 12 022.2521... -> 12 022.25
--      amount = round(1 250 x 12 022.25) = round(15 027 812.50) = 15 027 813
--      usd_rate 12 000.00 -> 12 022.25, amount 15 000 000 -> 15 027 813
-- 2. 2026-11-24 equipment, $90 (bccc7d32): dollars left 1 765 - 1 250 = 515,
--    their cost 21 219 275 - 15 027 813 = 6 191 462
--      6 191 462 / 515 = 12 022.2563... -> 12 022.26
--      amount = round(90 x 12 022.26) = round(1 082 003.40) = 1 082 003
--      usd_rate 12 000.00 -> 12 022.26, amount 1 080 000 -> 1 082 003
-- Afterwards the club holds 1 765 - 1 250 - 90 = $425, which cost
-- 6 191 462 - 1 082 003 = 5 109 459; 5 109 459 / 425 = 12 022.2562... ->
-- dollar_cost_rate 12 022.26. The sums the rows add to expenses: +27 813 and
-- +2 003. usd_amount, dates, methods and every other column are unchanged.
--
-- DESTRUCTIVE: updates two existing expenses rows in place (usd_rate and
-- amount). Each row as it was is kept by the record_entry_audit trigger (111)
-- in entry_audit_logs, with no user (changed_by null); 183's notice marker
-- does not mark an expense update, so no Telegram notice is sent.
--
-- No trigger is disabled. Every trigger on public.expenses that fires on
-- UPDATE, as run by the migration role with auth.uid() null:
--   expenses_cash_shortage_guard (135) - refuses only rows with a
--     cash_shortage_id; both rows have none (checked below).
--   expenses_collected_guard (169) - refuses only a change of
--     paid_from_collected, or a paid_from_collected row that is not in sums;
--     neither applies. It is not the closed-day lock.
--   expenses_method_balance (125, function 136) - fires (amount is a watched
--     column) and returns at once: auth.uid() is null. It would pass anyway:
--     same method, usd_amount not raised.
--   expenses_reserve_guard (136, function 155) - on update refuses only a
--     reserve purchase whose amount changes; both rows have
--     paid_from_reserve false.
--   lock_collected_day (097) - refuses any change on a business date ticked
--     as collected in daily_cash_collections (096), whoever makes it. This
--     depends on production data: if 31 October or 24 November is ticked, the
--     migration stops on the check below and changes nothing (the day must be
--     reopened first; this file does not lift the tick).
--   protect_salary_expense (059, function 127) - refuses only edits of a row
--     with a salary_entry_id; both rows have none (checked below).
--   expenses_never_negative (146, function 169, AFTER) - a usd row whose
--     usd_amount and date are unchanged returns at once.
--   record_entry_audit (111, AFTER) - logs the old and new row.
-- Insert-only triggers (expenses_at_dollar_cost 184, require_entry_note 108,
-- trg_expense_date_guard 086, trg_expense_preset_guard 091) do not fire.
-- The expenses_usd_amounts check (124), amount = round(usd_amount x
-- usd_rate), holds for both new pairs. The 083 revoke takes UPDATE on
-- expenses from the authenticated role only; the migration runs as the table
-- owner, which RLS does not restrict (no FORCE ROW LEVEL SECURITY).
--
-- Guards: before changing anything the club's dollar exchanges must still be
-- the two purchases above (21 219 275.00 sums for 1 765.00 dollars, nothing
-- sold) and these two rows its only dollar expenses. Afterwards
-- dollar_cost_rate must be 12 022.26 and the club's dollars must stay at zero
-- or above on every day since 31 October. Any failure raises, and as one DO
-- block nothing is changed.
--
-- Each row is matched on its id, club and old values. A row already at its
-- new values is left alone; a database without these rows (local, tests)
-- changes nothing; a row in any other state stops the migration instead of
-- being overwritten. Re-runnable.

do $$
declare
  club constant uuid := '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305';
  rent_id constant uuid := '2d1e9e57-435d-4101-a6fb-a5bfcbd6c582';
  equipment_id constant uuid := 'bccc7d32-a709-4550-b9a0-f83367aee84b';
  rent public.expenses;
  equipment public.expenses;
  rent_found boolean;
  equipment_found boolean;
  rent_is_old boolean;
  rent_is_new boolean;
  equipment_is_old boolean;
  equipment_is_new boolean;
  sums_paid numeric;
  dollars_bought numeric;
  sold_count integer;
  dollar_expense_count integer;
  closed_day date;
  changed integer;
  cost numeric;
begin
  -- The lock every dollar writer takes (125/136, 144, 184), so no dollar
  -- expense or exchange is priced or checked against half of this change.
  perform pg_advisory_xact_lock(hashtextextended('expense_method_balance:' || club::text, 0));

  -- In date order.
  select * into rent from public.expenses where id = rent_id and club_id = club for update;
  rent_found := found;
  select * into equipment from public.expenses where id = equipment_id and club_id = club for update;
  equipment_found := found;

  if not rent_found and not equipment_found then
    raise notice 'Dollar expenses 2d1e9e57 and bccc7d32 are not in this database; nothing to reprice.';
    return;
  end if;
  if not rent_found or not equipment_found then
    raise exception 'Only one of the dollar expenses 2d1e9e57 and bccc7d32 is in this database; not changed.';
  end if;

  -- Both rows: a Game Club dollar expense, not from the reserve, payroll or a shortage.
  if rent.date is distinct from date '2026-10-31' or rent.category is distinct from 'rent'
    or rent.payment_method is distinct from 'usd' or rent.usd_amount is distinct from 1250.00
    or rent.paid_from_reserve or rent.salary_entry_id is not null or rent.cash_shortage_id is not null
    or equipment.date is distinct from date '2026-11-24' or equipment.category is distinct from 'equipment'
    or equipment.payment_method is distinct from 'usd' or equipment.usd_amount is distinct from 90.00
    or equipment.paid_from_reserve or equipment.salary_entry_id is not null or equipment.cash_shortage_id is not null then
    raise exception 'Dollar expenses 2d1e9e57 (% % % $%) and bccc7d32 (% % % $%) are not the expected rows; not changed.',
      rent.date, rent.category, rent.payment_method, rent.usd_amount,
      equipment.date, equipment.category, equipment.payment_method, equipment.usd_amount;
  end if;

  rent_is_old := rent.usd_rate = 12000.00 and rent.amount = 15000000;
  rent_is_new := rent.usd_rate = 12022.25 and rent.amount = 15027813;
  equipment_is_old := equipment.usd_rate = 12000.00 and equipment.amount = 1080000;
  equipment_is_new := equipment.usd_rate = 12022.26 and equipment.amount = 1082003;

  if not (rent_is_old or rent_is_new) then
    raise exception 'Dollar expense 2d1e9e57 is neither at 12 000 nor repriced (rate %, amount %); not changed.',
      rent.usd_rate, rent.amount;
  end if;
  if not (equipment_is_old or equipment_is_new) then
    raise exception 'Dollar expense bccc7d32 is neither at 12 000 nor repriced (rate %, amount %); not changed.',
      equipment.usd_rate, equipment.amount;
  end if;
  if rent_is_new and equipment_is_new then
    return; -- Already repriced.
  end if;

  -- The purchases the new rates were derived from.
  select coalesce(sum(from_amount) filter (where to_method = 'usd'), 0),
         coalesce(sum(to_amount) filter (where to_method = 'usd'), 0),
         count(*) filter (where from_method = 'usd')
  into sums_paid, dollars_bought, sold_count
  from public.money_exchanges
  where club_id = club and (to_method = 'usd' or from_method = 'usd');
  if sums_paid <> 21219275.00 or dollars_bought <> 1765.00 or sold_count <> 0 then
    raise exception 'The club''s dollar exchanges changed (% sums for $%, % sold); the new rates no longer follow, not changed.',
      sums_paid, dollars_bought, sold_count;
  end if;

  select count(*) into dollar_expense_count
  from public.expenses
  where club_id = club and payment_method = 'usd';
  if dollar_expense_count <> 2 then
    raise exception 'The club has % dollar expenses, not the two this repricing was derived from; not changed.',
      dollar_expense_count;
  end if;

  -- lock_collected_day (097) refuses a change on a closed day; say which one.
  select min(date) into closed_day
  from public.daily_cash_collections
  where club_id = club
    and date in (
      case when rent_is_old then rent.date end,
      case when equipment_is_old then equipment.date end);
  if closed_day is not null then
    raise exception 'The money for % has been collected; the day is closed. Reopen it before repricing; not changed.',
      closed_day using errcode = '55000', hint = 'day_collected';
  end if;

  if rent_is_old then
    update public.expenses
    set usd_rate = 12022.25,
        amount = 15027813
    where id = rent_id and club_id = club
      and payment_method = 'usd' and usd_amount = 1250.00
      and usd_rate = 12000.00 and amount = 15000000;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'Dollar expense 2d1e9e57 was not repriced (% rows); not changed.', changed;
    end if;
  end if;

  -- What 184 would price the equipment at, with the rent repriced.
  cost := public.dollar_cost_rate(club, equipment_id);
  if cost is distinct from 12022.26 then
    raise exception 'The dollars left after the rent cost % each, not 12 022.26; not changed.', cost;
  end if;

  if equipment_is_old then
    update public.expenses
    set usd_rate = 12022.26,
        amount = 1082003
    where id = equipment_id and club_id = club
      and payment_method = 'usd' and usd_amount = 90.00
      and usd_rate = 12000.00 and amount = 1080000;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'Dollar expense bccc7d32 was not repriced (% rows); not changed.', changed;
    end if;
  end if;

  -- The $425 left cost 5 109 459.
  cost := public.dollar_cost_rate(club);
  if cost is distinct from 12022.26 then
    raise exception 'After repricing the dollars held cost % each, not 12 022.26; not changed.', cost;
  end if;
  if coalesce(public.method_daily_lowest_balance(club, 'usd', date '2026-10-31'), 0) < 0 then
    raise exception 'Repricing would leave the club''s dollars negative; not changed.';
  end if;
end;
$$;
