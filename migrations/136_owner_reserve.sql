-- Owner reserve (jamg'arma): profit the owner sets aside in the club instead of
-- taking it home, to save over months for new PCs or repairs.
--
-- owner_reserve_entries is the ledger:
--   deposit: money leaves a month's owner profit (like a withdrawal, but it
--            stays in the club, in a Game Club payment method or the bar);
--   return:  reserve money goes back into a month's owner profit.
-- A purchase paid from the reserve is an ordinary expense with
-- `paid_from_reserve`. It counts in every expense total (Reports, analysis,
-- Telegram), but the reserve pays for it: the month it falls in keeps its
-- owner profit and its expense limit.
--
-- reserve balance = deposits - returns - reserve purchases, per source, and per
-- payment method on the Game Club side (Bar money has no method, as in 071).
--
-- Every owner-withdrawal limit goes through owner_source_earned_for_month and
-- owner_payment_method_earned_for_month (029/051/066/071), and the expense limit
-- through expense_method_balance (125). Each gains one term,
-- owner_reserve_month_effect, so withdrawals, carryovers and the "All" split all
-- respect the reserve without changing their RPCs. Owner-only writes. Re-runnable.

create table if not exists public.owner_reserve_entries (
  id uuid primary key, -- caller's retry/idempotency key
  club_id uuid not null references public.clubs(id) on delete cascade,
  kind text not null check (kind in ('deposit', 'return')),
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  source text not null check (source in ('game_club', 'bar')),
  payment_method text,
  amount numeric(16,2) not null check (amount > 0 and amount < 100000000000000 and amount = round(amount)),
  comment text check (comment is null or length(comment) <= 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (
    (source = 'game_club' and payment_method in ('cash', 'terminal', 'card', 'playstation'))
    or (source = 'bar' and payment_method is null)
  )
);
create index if not exists owner_reserve_entries_club_month
  on public.owner_reserve_entries(club_id, source, period_month);

create table if not exists public.owner_reserve_goals (
  club_id uuid not null references public.clubs(id) on delete cascade,
  source text not null check (source in ('game_club', 'bar')),
  title text not null check (length(btrim(title)) between 1 and 120),
  target_amount numeric(16,2) not null check (target_amount > 0 and target_amount < 100000000000000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (club_id, source)
);

alter table public.owner_reserve_entries enable row level security;
alter table public.owner_reserve_goals enable row level security;
revoke all on public.owner_reserve_entries, public.owner_reserve_goals from public, anon, authenticated;
grant select on public.owner_reserve_entries, public.owner_reserve_goals to authenticated;
drop policy if exists owner_reserve_entries_read on public.owner_reserve_entries;
create policy owner_reserve_entries_read on public.owner_reserve_entries for select to authenticated
  using (club_id in (select public.current_user_readable_clubs(array['owner_profit']::text[])));
drop policy if exists owner_reserve_goals_read on public.owner_reserve_goals;
create policy owner_reserve_goals_read on public.owner_reserve_goals for select to authenticated
  using (club_id in (select public.current_user_readable_clubs(array['owner_profit']::text[])));

alter table public.expenses add column if not exists paid_from_reserve boolean not null default false;
create index if not exists expenses_paid_from_reserve
  on public.expenses(club_id, date) where paid_from_reserve;

-- The Game Club method an expense draws on (125's bucketing); null for Bar.
create or replace function public.reserve_expense_method(p_source text, p_method text)
returns text language sql immutable set search_path = public as $$
  select case when coalesce(p_source, 'game_club') <> 'game_club' then null
    when p_method in ('cash', 'terminal', 'playstation') then p_method else 'card' end
$$;
revoke all on function public.reserve_expense_method(text, text) from public, anon, authenticated;

-- What is in the reserve now. A null method on the Game Club side means every method.
create or replace function public.owner_reserve_balance(p_club_id uuid, p_source text, p_payment_method text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((
      select sum(case kind when 'deposit' then amount else -amount end)
      from public.owner_reserve_entries
      where club_id = p_club_id and source = p_source
        and (p_payment_method is null or payment_method = p_payment_method)
    ), 0)
    - coalesce((
      select sum(amount) from public.expenses
      where club_id = p_club_id and paid_from_reserve
        and coalesce(payment_source, 'game_club') = p_source
        and (p_payment_method is null or public.reserve_expense_method(payment_source, payment_method) = p_payment_method)
    ), 0)
$$;
revoke all on function public.owner_reserve_balance(uuid, text, text) from public, anon, authenticated;

-- How the reserve changes one month's owner profit: deposits take money out,
-- returns put it back, and a reserve purchase gives back what it cost the month.
create or replace function public.owner_reserve_month_effect(
  p_club_id uuid, p_source text, p_payment_method text, p_month date
) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((
      select sum(case kind when 'deposit' then -amount else amount end)
      from public.owner_reserve_entries
      where club_id = p_club_id and source = p_source and period_month = date_trunc('month', p_month)::date
        and (p_payment_method is null or payment_method = p_payment_method)
    ), 0)
    + coalesce((
      select sum(amount) from public.expenses
      where club_id = p_club_id and paid_from_reserve
        and coalesce(payment_source, 'game_club') = p_source
        and date >= date_trunc('month', p_month)::date
        and date < (date_trunc('month', p_month) + interval '1 month')::date
        and (p_payment_method is null or public.reserve_expense_method(payment_source, payment_method) = p_payment_method)
    ), 0)
$$;
revoke all on function public.owner_reserve_month_effect(uuid, text, text, date) from public, anon, authenticated;

-- 071 unchanged, plus the reserve.
create or replace function public.owner_source_earned_for_month(
  p_club_id uuid,
  p_source text,
  p_period_month date
)
returns numeric
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  month_start date := date_trunc('month', p_period_month)::date;
  next_month date := (date_trunc('month', p_period_month) + interval '1 month')::date;
  earned numeric := 0;
  source_costs numeric := 0;
  carried numeric := 0;
begin
  if p_period_month <> month_start then
    raise exception 'Owner withdrawal period must be the first day of a calendar month'
      using errcode = '23514';
  end if;

  if p_source = 'game_club' then
    select coalesce(sum(
      coalesce(cash_income, 0)
      + coalesce(terminal_income, 0)
      + coalesce(card_income, 0)
      + coalesce(playstation_income, 0)
    ), 0)
    into earned
    from public.daily_cash_entries
    where club_id = p_club_id
      and date >= month_start
      and date < next_month;

    select earned + coalesce(sum(amount), 0)
    into earned
    from public.debt_payments
    where club_id = p_club_id
      and date >= month_start
      and date < next_month;

    select coalesce(sum(amount), 0)
    into source_costs
    from public.expenses
    where club_id = p_club_id
      and payment_source = 'game_club'
      and date >= month_start
      and date < next_month;
  elsif p_source = 'bar' then
    select coalesce(sum(bar_income), 0)
    into earned
    from public.daily_stock_counts
    where club_id = p_club_id
      and date >= month_start
      and date < next_month;

    select coalesce(sum(quantity * cost_price), 0)
    into source_costs
    from public.stock_purchases
    where club_id = p_club_id
      and date >= greatest(month_start, date '2026-07-02')
      and date < next_month;

    select source_costs + coalesce(sum(amount), 0)
    into source_costs
    from public.expenses
    where club_id = p_club_id
      and payment_source = 'bar'
      and date >= month_start
      and date < next_month;
  else
    raise exception 'Unknown owner withdrawal source: %', p_source
      using errcode = '23514';
  end if;

  select coalesce(sum(case when to_month = month_start then amount else -amount end), 0)
  into carried
  from public.owner_profit_carryovers
  where club_id = p_club_id
    and source = p_source
    and (to_month = month_start or from_month = month_start);

  return earned - source_costs + carried
    + public.owner_reserve_month_effect(p_club_id, p_source, null, month_start);
end;
$$;
revoke all on function public.owner_source_earned_for_month(uuid, text, date)
  from public, anon, authenticated;

-- 124 unchanged, plus the reserve.
create or replace function public.owner_payment_method_earned_for_month(
  p_club_id uuid,
  p_payment_method text,
  p_period_month date
)
returns numeric
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  month_start date := date_trunc('month', p_period_month)::date;
  next_month date := (date_trunc('month', p_period_month) + interval '1 month')::date;
  earned numeric := 0;
begin
  if p_payment_method is null or p_payment_method not in ('cash', 'terminal', 'card', 'playstation') then
    raise exception 'Unknown owner withdrawal payment method: %', p_payment_method
      using errcode = '23514';
  end if;

  select coalesce(sum(case p_payment_method
      when 'cash' then coalesce(cash_income, 0)
      when 'terminal' then coalesce(terminal_income, 0)
      when 'card' then coalesce(card_income, 0)
      else coalesce(playstation_income, 0)
    end), 0)
  into earned
  from public.daily_cash_entries
  where club_id = p_club_id
    and date >= month_start
    and date < next_month;

  select earned - coalesce(sum(amount), 0)
  into earned
  from public.expenses
  where club_id = p_club_id
    and date >= month_start
    and date < next_month
    and coalesce(payment_source, 'game_club') = 'game_club'
    and payment_method is distinct from 'usd'
    and case when payment_method in ('cash', 'terminal', 'playstation') then payment_method else 'card' end
      = p_payment_method;

  if p_payment_method <> 'playstation' then
    select earned + coalesce(sum(amount), 0)
    into earned
    from public.debt_payments
    where club_id = p_club_id
      and date >= month_start
      and date < next_month
      and case when payment_method in ('cash', 'terminal') then payment_method else 'card' end
        = p_payment_method;

    select earned
      + coalesce(sum(case when to_method = p_payment_method then to_amount else 0 end), 0)
      - coalesce(sum(case when from_method = p_payment_method then from_amount else 0 end), 0)
    into earned
    from public.money_exchanges
    where club_id = p_club_id
      and date >= month_start
      and date < next_month
      and (from_method = p_payment_method or to_method = p_payment_method);
  end if;

  select earned + coalesce(sum(case when to_month = month_start then amount else -amount end), 0)
  into earned
  from public.owner_profit_carryovers
  where club_id = p_club_id
    and source = 'game_club'
    and payment_method = p_payment_method
    and (to_month = month_start or from_month = month_start);

  return earned + public.owner_reserve_month_effect(p_club_id, 'game_club', p_payment_method, month_start);
end;
$$;
revoke all on function public.owner_payment_method_earned_for_month(uuid, text, date)
  from public, anon, authenticated;

-- 125 unchanged, plus the reserve: money put into the reserve this month cannot
-- pay ordinary expenses, and a reserve purchase does not use the month's money.
create or replace function public.expense_method_balance(
  p_club_id uuid,
  p_method text,
  p_date date,
  p_exclude_expense uuid default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  month_start date := date_trunc('month', p_date)::date;
  next_month date := (date_trunc('month', p_date) + interval '1 month')::date;
  balance numeric := 0;
begin
  if p_method = 'usd' then
    select coalesce(sum(case when to_method = 'usd' then to_amount else -from_amount end), 0)
    into balance
    from public.money_exchanges
    where club_id = p_club_id and (to_method = 'usd' or from_method = 'usd');

    select balance - coalesce(sum(usd_amount), 0)
    into balance
    from public.expenses
    where club_id = p_club_id
      and payment_method = 'usd'
      and id is distinct from p_exclude_expense;
    return balance;
  end if;

  if p_method is null or p_method not in ('cash', 'terminal', 'card', 'playstation') then
    raise exception 'Unknown payment method: %', p_method using errcode = '22023';
  end if;

  select coalesce(sum(case p_method
      when 'cash' then coalesce(cash_income, 0)
      when 'terminal' then coalesce(terminal_income, 0)
      when 'card' then coalesce(card_income, 0)
      else coalesce(playstation_income, 0)
    end), 0)
  into balance
  from public.daily_cash_entries
  where club_id = p_club_id and date >= month_start and date < next_month;

  select balance - coalesce(sum(amount), 0)
  into balance
  from public.expenses
  where club_id = p_club_id
    and date >= month_start and date < next_month
    and coalesce(payment_source, 'game_club') = 'game_club'
    and payment_method is distinct from 'usd'
    and case when payment_method in ('cash', 'terminal', 'playstation') then payment_method else 'card' end = p_method
    and id is distinct from p_exclude_expense;

  if p_method <> 'playstation' then
    select balance + coalesce(sum(amount), 0)
    into balance
    from public.debt_payments
    where club_id = p_club_id
      and date >= month_start and date < next_month
      and case when payment_method in ('cash', 'terminal') then payment_method else 'card' end = p_method;

    select balance
      + coalesce(sum(case when to_method = p_method then to_amount else 0 end), 0)
      - coalesce(sum(case when from_method = p_method then from_amount else 0 end), 0)
    into balance
    from public.money_exchanges
    where club_id = p_club_id
      and date >= month_start and date < next_month
      and (from_method = p_method or to_method = p_method);
  end if;

  return balance + public.owner_reserve_month_effect(p_club_id, 'game_club', p_method, month_start);
end;
$$;
revoke all on function public.expense_method_balance(uuid, text, date, uuid) from public, anon, authenticated;

-- 135 unchanged, except a reserve purchase is checked against the reserve instead.
create or replace function public.enforce_expense_method_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  available numeric;
  spent numeric;
  spent_before numeric;
  method text;
begin
  -- Plain assignments: PL/pgSQL ends an IF condition at the first THEN, even one inside a CASE.
  spent := case when new.payment_method = 'usd' then new.usd_amount else new.amount end;
  if tg_op = 'UPDATE' then
    spent_before := case when old.payment_method = 'usd' then old.usd_amount else old.amount end;
  end if;
  method := case when new.payment_method in ('cash', 'terminal', 'playstation', 'usd') then new.payment_method else 'card' end;
  if auth.uid() is null
    or new.salary_entry_id is not null
    or new.cash_shortage_id is not null
    or new.paid_from_reserve
    or coalesce(new.payment_source, 'game_club') <> 'game_club' then
    return new;
  end if;
  -- A correction that spends no more from the same method and month is always fine.
  if tg_op = 'UPDATE'
    and old.payment_method is not distinct from new.payment_method
    and coalesce(old.payment_source, 'game_club') = 'game_club'
    and (new.payment_method = 'usd' or date_trunc('month', old.date) = date_trunc('month', new.date))
    and spent <= spent_before then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('expense_method_balance:' || new.club_id::text, 0));
  available := public.expense_method_balance(new.club_id, method, new.date, new.id);
  if spent > available then
    raise exception 'Insufficient payment method balance: % available', available
      using errcode = 'P0001', hint = 'INSUFFICIENT_BALANCE';
  end if;
  return new;
end;
$$;

-- A reserve purchase: owners only, never payroll, a shortage or dollars, never
-- more than the reserve holds, and it keeps its amount, side and method.
create or replace function public.guard_reserve_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare source_value text; method_value text;
begin
  if TG_OP = 'UPDATE' then
    if NEW.paid_from_reserve is distinct from OLD.paid_from_reserve
      or (NEW.paid_from_reserve and (
        NEW.amount is distinct from OLD.amount
        or NEW.payment_method is distinct from OLD.payment_method
        or NEW.payment_source is distinct from OLD.payment_source
        or NEW.club_id is distinct from OLD.club_id)) then
      raise exception 'A reserve purchase keeps its amount, side and payment method.'
        using errcode = '23514', hint = 'reserve_expense_locked';
    end if;
    return NEW;
  end if;
  if not NEW.paid_from_reserve then return NEW; end if;
  if auth.uid() is not null and public.current_user_club_role(NEW.club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can spend the reserve.' using errcode = '42501';
  end if;
  if NEW.salary_entry_id is not null or NEW.cash_shortage_id is not null
    or NEW.category in ('salary', 'shortage') or NEW.payment_method = 'usd' then
    raise exception 'This expense cannot be paid from the reserve.' using errcode = '23514', hint = 'reserve_expense_invalid';
  end if;
  source_value := coalesce(NEW.payment_source, 'game_club');
  method_value := public.reserve_expense_method(source_value, NEW.payment_method);
  perform pg_advisory_xact_lock(hashtextextended('owner_reserve:' || NEW.club_id::text || ':' || source_value, 0));
  if NEW.amount > public.owner_reserve_balance(NEW.club_id, source_value, method_value) then
    raise exception 'The reserve holds less than this purchase.' using errcode = '23514', hint = 'reserve_insufficient';
  end if;
  return NEW;
end;
$$;
revoke all on function public.guard_reserve_expense() from public, anon, authenticated;
drop trigger if exists expenses_reserve_guard on public.expenses;
create trigger expenses_reserve_guard before insert or update on public.expenses
  for each row execute function public.guard_reserve_expense();

create or replace function public.move_owner_profit_to_reserve(
  p_club_id uuid, p_id uuid, p_period_month date, p_source text, p_payment_method text,
  p_amount numeric, p_comment text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare existing public.owner_reserve_entries; available numeric;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can use the reserve.' using errcode = '42501';
  end if;
  if p_id is null or p_period_month is null or p_period_month <> date_trunc('month', p_period_month)::date
    or p_source is null or p_source not in ('game_club', 'bar')
    or (p_source = 'game_club' and (p_payment_method is null or p_payment_method not in ('cash', 'terminal', 'card', 'playstation')))
    or (p_source = 'bar' and p_payment_method is not null)
    or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount) or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid reserve month, source, payment method or amount.' using errcode = '23514';
  end if;
  if p_period_month > date_trunc('month', public.club_business_date(p_club_id))::date then
    raise exception 'Owner profit cannot be reserved from a future month.' using errcode = '22008';
  end if;

  -- Same bucket lock as owner withdrawals and carryovers for the month.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':' || p_source || ':' || p_period_month::text, 0));
  select * into existing from public.owner_reserve_entries where club_id = p_club_id and id = p_id;
  if found then
    if existing.kind <> 'deposit' or existing.period_month <> p_period_month or existing.source <> p_source
      or existing.payment_method is distinct from p_payment_method or existing.amount <> p_amount then
      raise exception 'This request has already been used for a different reserve entry.';
    end if;
    return false;
  end if;

  available := public.owner_profit_bucket_available(p_club_id, p_source, p_payment_method, p_period_month);
  if p_amount > available then
    raise exception 'The reserve deposit (%) exceeds the available % balance (%) for %',
      p_amount, p_source, greatest(available, 0), p_period_month
      using errcode = '23514', hint = 'reserve_exceeds_available';
  end if;
  insert into public.owner_reserve_entries (id, club_id, kind, period_month, source, payment_method, amount, comment, created_by)
    values (p_id, p_club_id, 'deposit', p_period_month, p_source, p_payment_method, p_amount, nullif(btrim(p_comment), ''), auth.uid());
  return true;
end;
$$;
revoke all on function public.move_owner_profit_to_reserve(uuid,uuid,date,text,text,numeric,text) from public, anon;
grant execute on function public.move_owner_profit_to_reserve(uuid,uuid,date,text,text,numeric,text) to authenticated;

create or replace function public.return_owner_reserve(
  p_club_id uuid, p_id uuid, p_period_month date, p_source text, p_payment_method text,
  p_amount numeric, p_comment text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare existing public.owner_reserve_entries; held numeric;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can use the reserve.' using errcode = '42501';
  end if;
  if p_id is null or p_period_month is null or p_period_month <> date_trunc('month', p_period_month)::date
    or p_source is null or p_source not in ('game_club', 'bar')
    or (p_source = 'game_club' and (p_payment_method is null or p_payment_method not in ('cash', 'terminal', 'card', 'playstation')))
    or (p_source = 'bar' and p_payment_method is not null)
    or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount) or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid reserve month, source, payment method or amount.' using errcode = '23514';
  end if;
  if p_period_month > date_trunc('month', public.club_business_date(p_club_id))::date then
    raise exception 'Reserve money cannot be returned to a future month.' using errcode = '22008';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('owner_reserve:' || p_club_id::text || ':' || p_source, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':' || p_source || ':' || p_period_month::text, 0));
  select * into existing from public.owner_reserve_entries where club_id = p_club_id and id = p_id;
  if found then
    if existing.kind <> 'return' or existing.period_month <> p_period_month or existing.source <> p_source
      or existing.payment_method is distinct from p_payment_method or existing.amount <> p_amount then
      raise exception 'This request has already been used for a different reserve entry.';
    end if;
    return false;
  end if;

  held := public.owner_reserve_balance(p_club_id, p_source, p_payment_method);
  if p_amount > held then
    raise exception 'The reserve holds % in this money, less than %.', greatest(held, 0), p_amount
      using errcode = '23514', hint = 'reserve_insufficient';
  end if;
  insert into public.owner_reserve_entries (id, club_id, kind, period_month, source, payment_method, amount, comment, created_by)
    values (p_id, p_club_id, 'return', p_period_month, p_source, p_payment_method, p_amount, nullif(btrim(p_comment), ''), auth.uid());
  return true;
end;
$$;
revoke all on function public.return_owner_reserve(uuid,uuid,date,text,text,numeric,text) from public, anon;
grant execute on function public.return_owner_reserve(uuid,uuid,date,text,text,numeric,text) to authenticated;

-- Undo a deposit or return. Refused when the money has since been used: a
-- deposit already spent or returned, or a return already withdrawn.
create or replace function public.delete_owner_reserve_entry(p_club_id uuid, p_entry_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare entry public.owner_reserve_entries;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can use the reserve.' using errcode = '42501';
  end if;
  select * into entry from public.owner_reserve_entries where club_id = p_club_id and id = p_entry_id;
  if not found then raise exception 'Reserve entry not found.' using errcode = 'P0002'; end if;

  perform pg_advisory_xact_lock(hashtextextended('owner_reserve:' || p_club_id::text || ':' || entry.source, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':' || entry.source || ':' || entry.period_month::text, 0));
  delete from public.owner_reserve_entries where club_id = p_club_id and id = entry.id;

  -- Raising rolls the delete back.
  if public.owner_reserve_balance(p_club_id, entry.source, entry.payment_method) < 0 then
    raise exception 'This reserve money has already been spent or returned.'
      using errcode = '23514', hint = 'reserve_already_used';
  end if;
  if public.owner_profit_bucket_available(p_club_id, entry.source, entry.payment_method, entry.period_month) < 0 then
    raise exception 'This money has already been withdrawn in %.', entry.period_month
      using errcode = '23514', hint = 'reserve_already_used';
  end if;
end;
$$;
revoke all on function public.delete_owner_reserve_entry(uuid,uuid) from public, anon;
grant execute on function public.delete_owner_reserve_entry(uuid,uuid) to authenticated;

-- What the reserve holds, for the expense form: per side, and per method on the Game Club side.
create or replace function public.get_owner_reserve_balances(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can see the reserve.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'game_club', jsonb_build_object(
      'total', public.owner_reserve_balance(p_club_id, 'game_club', null),
      'cash', public.owner_reserve_balance(p_club_id, 'game_club', 'cash'),
      'terminal', public.owner_reserve_balance(p_club_id, 'game_club', 'terminal'),
      'card', public.owner_reserve_balance(p_club_id, 'game_club', 'card'),
      'playstation', public.owner_reserve_balance(p_club_id, 'game_club', 'playstation')
    ),
    'bar', jsonb_build_object('total', public.owner_reserve_balance(p_club_id, 'bar', null))
  );
end;
$$;
revoke all on function public.get_owner_reserve_balances(uuid) from public, anon;
grant execute on function public.get_owner_reserve_balances(uuid) to authenticated;

-- A savings goal per side, e.g. "New PCs: 30 000 000". A null or zero amount removes it.
create or replace function public.set_owner_reserve_goal(
  p_club_id uuid, p_source text, p_title text, p_target_amount numeric
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can set a reserve goal.' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('game_club', 'bar') then
    raise exception 'Invalid reserve source.' using errcode = '23514';
  end if;
  if p_target_amount is null or p_target_amount <= 0 then
    delete from public.owner_reserve_goals where club_id = p_club_id and source = p_source;
    return;
  end if;
  if p_target_amount <> round(p_target_amount) or length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Invalid reserve goal.' using errcode = '23514';
  end if;
  insert into public.owner_reserve_goals (club_id, source, title, target_amount, updated_by, updated_at)
    values (p_club_id, p_source, btrim(p_title), p_target_amount, auth.uid(), now())
    on conflict (club_id, source) do update
      set title = excluded.title, target_amount = excluded.target_amount,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;
revoke all on function public.set_owner_reserve_goal(uuid,text,text,numeric) from public, anon;
grant execute on function public.set_owner_reserve_goal(uuid,text,text,numeric) to authenticated;

-- Edit and delete history (111) covers the reserve ledger.
drop trigger if exists record_entry_audit on public.owner_reserve_entries;
create trigger record_entry_audit after update or delete on public.owner_reserve_entries
  for each row execute function public.record_entry_audit();
