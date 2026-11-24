-- A dollar expense is counted at what its dollars cost (docs/plans/dollar-account-expenses.md).
--
-- An expense paid from the reserve's USD account (124, 143) used to be booked
-- at a rate the person typed: amount = round(usd_amount x usd_rate). Whatever
-- was typed moved the sums value of the dollars still held, so their average
-- purchase price drifted away from what was paid for them. From now on the
-- database sets the rate: the average purchase price of the dollars held just
-- before the expense.
--
--   dollar_cost_rate(club): sums value of the dollars held / dollars held,
--     rounded to 2 decimals; null when no dollars are held or their sums value
--     is not positive. The sums value is what the reserve's 'usd' bucket holds
--     (owner_reserve_balance, 143): sums paid for dollars - sums received for
--     dollars - the amount of every dollar expense, all time. The dollars are
--     expense_method_balance(club, 'usd') (125/136): bought - sold - spent.
--   price_dollar_expense(): BEFORE INSERT on expenses, for dollar rows written
--     by a signed-in user (auth.uid() not null). Under the advisory lock the
--     balance trigger takes, it sets usd_rate := dollar_cost_rate(club) and
--     amount := round(usd_amount x usd_rate), whatever the client sent.
--     Migrations, service-role writes and seeds keep the values they pass.
--     With no dollars held it leaves the row alone, so the balance trigger
--     refuses it with INSUFFICIENT_BALANCE as before. With dollars held but no
--     positive sums value (they were sold for more than all of them cost) the
--     cost is unknown and the expense is refused (23514, dollar_cost_unknown).
--   get_expense_method_balances: 125 unchanged, plus usdCostRate, the cost of
--     one dollar now, for the form's "counted as about" preview. Every existing
--     key stays.
--
-- Consequences: spending dollars never moves the average price of the dollars
-- left (only buying or selling does), and a rate gain or loss is still never
-- profit. A backdated dollar expense is priced at today's cost, the same
-- all-time basis the dollar limit uses (136). Deleting a dollar expense needs
-- nothing: its amount returns to the bucket. Existing rows are not repriced
-- here (a later migration).
--
-- Trigger order, verified against every trigger on public.expenses in the
-- migration chain. Postgres fires triggers of the same kind in name order, so
-- expenses_at_dollar_cost runs first of the BEFORE INSERT row triggers:
--   expenses_at_dollar_cost       (this file)
--   expenses_cash_shortage_guard  (135)
--   expenses_collected_guard      (169)
--   expenses_method_balance       (125; function from 136) - dollars held
--   expenses_reserve_guard        (136; function from 155)
--   lock_collected_day            (097)
--   protect_salary_expense        (059)
--   require_entry_note            (108)
--   trg_expense_date_guard        (086)
--   trg_expense_preset_guard      (091)
-- expenses_never_negative (146/169) and the audit triggers (111, 183) are
-- AFTER triggers, and the expenses_usd_amounts check (124) and NOT NULL are
-- checked after every BEFORE trigger, so all of them see the priced row. None
-- of the later BEFORE triggers changes amount, usd_amount, usd_rate or
-- payment_method.
--
-- No row is changed or removed. DROP TRIGGER IF EXISTS only drops the trigger
-- this file creates, so it can run again. Re-runnable.

create or replace function public.dollar_cost_rate(p_club_id uuid, p_exclude_expense uuid default null)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  dollars numeric;
  sums_value numeric;
begin
  -- The dollar balance ignores the date: every dollar bought, sold or spent counts.
  dollars := public.expense_method_balance(p_club_id, 'usd', current_date, p_exclude_expense);
  if dollars is null or dollars <= 0 then
    return null;
  end if;

  select coalesce(sum(case when to_method = 'usd' then from_amount else -to_amount end), 0)
  into sums_value
  from public.money_exchanges
  where club_id = p_club_id and (to_method = 'usd' or from_method = 'usd');

  select sums_value - coalesce(sum(amount), 0)
  into sums_value
  from public.expenses
  where club_id = p_club_id
    and payment_method = 'usd'
    and id is distinct from p_exclude_expense;

  if sums_value <= 0 then
    return null;
  end if;
  return round(sums_value / dollars, 2);
end;
$$;
revoke all on function public.dollar_cost_rate(uuid, uuid) from public, anon, authenticated;

create or replace function public.price_dollar_expense()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cost numeric;
begin
  if new.payment_method is distinct from 'usd' or auth.uid() is null
    or new.usd_amount is null or new.usd_amount <= 0 then
    return new;
  end if;
  -- The lock expenses_method_balance and the exchange checks take (125, 144),
  -- so the dollars and their cost cannot change before the row is written.
  perform pg_advisory_xact_lock(hashtextextended('expense_method_balance:' || new.club_id::text, 0));
  cost := public.dollar_cost_rate(new.club_id, new.id);
  if cost is null then
    if public.expense_method_balance(new.club_id, 'usd', new.date, new.id) > 0 then
      raise exception 'The cost of the dollars held is unknown.'
        using errcode = '23514', hint = 'dollar_cost_unknown';
    end if;
    -- No dollars held: expenses_method_balance refuses it.
    return new;
  end if;
  new.usd_rate := cost;
  new.amount := round(new.usd_amount * cost);
  return new;
end;
$$;
revoke all on function public.price_dollar_expense() from public, anon, authenticated;

drop trigger if exists expenses_at_dollar_cost on public.expenses;
create trigger expenses_at_dollar_cost
  before insert on public.expenses
  for each row execute function public.price_dollar_expense();

-- 125 unchanged, plus usdCostRate: what one dollar held cost (null without dollars).
create or replace function public.get_expense_method_balances(p_club_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is null then
    raise exception 'Not a member of this club.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'cash', public.expense_method_balance(p_club_id, 'cash', p_date),
    'terminal', public.expense_method_balance(p_club_id, 'terminal', p_date),
    'card', public.expense_method_balance(p_club_id, 'card', p_date),
    'playstation', public.expense_method_balance(p_club_id, 'playstation', p_date),
    'usd', public.expense_method_balance(p_club_id, 'usd', p_date),
    'usdRate', (
      select rate from public.money_exchanges
      where club_id = p_club_id and rate is not null and date <= p_date
      order by date desc, created_at desc
      limit 1
    ),
    'usdCostRate', public.dollar_cost_rate(p_club_id)
  );
end;
$$;

revoke all on function public.get_expense_method_balances(uuid, date) from public, anon;
grant execute on function public.get_expense_method_balances(uuid, date) to authenticated;
