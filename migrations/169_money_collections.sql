-- Collected money: a third place Game Club money can sit, between the admin's
-- till and the owner reserve.
--
-- Until now "Mark as collected" only ticked a business date (096, 148), and
-- Reports showed each ticked day's own net as what the collector took. When
-- the admin kept three days of cash and paid a 3 000 000 bill on the third,
-- that day read as minus 3 000 000 although the money came from all three.
-- The till is a running balance, not a sum of separate days.
--
--   money_collections: one row per payment method a collector took out of the
--     till on a business date (cash, terminal, card, PlayStation). The money
--     leaves the till and is held as "collected" until it pays for something,
--     goes into the reserve, or the month ends (it stays that month's owner
--     profit). Rows of one collect share request_id. Read like the 096 ticks;
--     written only through collect_money and the owner-only
--     delete_money_collection. Audited (111).
--   expenses.paid_from_collected: the expense was paid from collected money,
--     not from the till. It is an ordinary Game Club expense of its method in
--     every total and limit (125 is unchanged); only where the cash sits differs.
--   owner_reserve_entries.from_collected: a deposit made from collected money
--     (move_collected_to_reserve). Owner profit treats it as any deposit.
--   get_collection_balances: what the till and collected money can give on a day.
--   get_collected_money_moves: collections and what collected money paid, for Reports.
--
-- Running balances per UZS method, each starting at zero every month:
--   till      = method_daily_lowest_balance as before, minus collections,
--               leaving out expenses paid from collected and deposits from collected
--   collected = collections - expenses paid from collected - deposits from collected
-- till + collected is the month's money left, the same figure as before.
-- Both stay at zero or above on every day for application users (146's rule):
-- a collection cannot take more than the till holds, an expense or deposit from
-- collected cannot spend more than was collected.
--
-- The 096 day tick still closes a day (097); it no longer stands for money.
--
-- Data: for every month with ticked days, the money the till held at the end
-- of its last ticked day (capped so no later day of the month goes below zero)
-- is recorded as collected on that day, per method, so this month's till does
-- not suddenly show money collectors already took.
--
-- Re-runnable.

create table if not exists public.money_collections (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  request_id uuid not null,
  date date not null,
  payment_method text not null,
  amount numeric not null,
  comment text,
  collected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint money_collections_method check (payment_method in ('cash', 'terminal', 'card', 'playstation')),
  constraint money_collections_amount check (amount > 0 and amount = round(amount)),
  constraint money_collections_request_method unique (club_id, request_id, payment_method)
);
create index if not exists money_collections_club_date on public.money_collections (club_id, date);

alter table public.money_collections enable row level security;
revoke all on public.money_collections from public, anon, authenticated;
grant select on public.money_collections to authenticated;
drop policy if exists money_collections_member_read on public.money_collections;
create policy money_collections_member_read on public.money_collections for select to authenticated
  using (club_id in (select public.current_user_readable_clubs(array['reports', 'expenses', 'collection']::text[])));

drop trigger if exists record_entry_audit on public.money_collections;
create trigger record_entry_audit after update or delete on public.money_collections
  for each row execute function public.record_entry_audit();

alter table public.expenses add column if not exists paid_from_collected boolean not null default false;
alter table public.owner_reserve_entries add column if not exists from_collected boolean not null default false;

alter table public.owner_reserve_entries drop constraint if exists owner_reserve_entries_from_collected;
alter table public.owner_reserve_entries add constraint owner_reserve_entries_from_collected
  check (not from_collected or (kind = 'deposit' and source = 'game_club'));

-- An expense paid from collected money: Game Club, a UZS method, not the
-- reserve, payroll or a shortage, by someone who collects (or an owner), and
-- it stays paid that way.
create or replace function public.expenses_collected_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.paid_from_collected is distinct from old.paid_from_collected then
    raise exception 'Where an expense was paid from cannot be changed.' using errcode = '23514';
  end if;
  if not new.paid_from_collected then
    return new;
  end if;
  if coalesce(new.payment_source, 'game_club') <> 'game_club'
    or new.payment_method is null or new.payment_method not in ('cash', 'terminal', 'card', 'playstation')
    or new.paid_from_reserve or new.cash_shortage_id is not null or new.salary_entry_id is not null then
    raise exception 'Only a Game Club expense in sums can be paid from collected money.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null
    and not public.current_user_can_access_club_feature(new.club_id, 'collection')
    and public.current_user_club_role(new.club_id) is distinct from 'owner' then
    raise exception 'Collection access is required to pay from collected money.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.expenses_collected_guard() from public, anon, authenticated;
drop trigger if exists expenses_collected_guard on public.expenses;
create trigger expenses_collected_guard before insert or update on public.expenses
  for each row execute function public.expenses_collected_guard();

-- Each day's closing balance of a method in the till or in collected money.
-- The till is 162's method_daily_lowest_balance flows (dollars across all
-- time), less collections and what collected money paid for.
create or replace function public.method_daily_balances(p_club_id uuid, p_method text, p_from date, p_holder text default 'till')
returns table(day date, balance numeric)
language sql stable security definer set search_path = public as $$
  with bounds as (
    select
      case when p_method = 'usd' then date '-infinity' else date_trunc('month', p_from)::date end as lo,
      case when p_method = 'usd' then date 'infinity' else (date_trunc('month', p_from) + interval '1 month')::date end as hi,
      date_trunc('month', p_from)::date as month_start
  ), till(day, amount) as (
    select e.date, case p_method
        when 'cash' then coalesce(e.cash_income, 0)
        when 'terminal' then coalesce(e.terminal_income, 0)
        when 'card' then coalesce(e.card_income, 0)
        else coalesce(e.playstation_income, 0) end
    from public.daily_cash_entries e, bounds b
    where p_method in ('cash', 'terminal', 'card', 'playstation')
      and e.club_id = p_club_id and e.date >= b.lo and e.date < b.hi
    union all
    select x.date, -case when p_method = 'usd' then coalesce(x.usd_amount, 0) else x.amount end
    from public.expenses x, bounds b
    where x.club_id = p_club_id and x.date >= b.lo and x.date < b.hi
      and not x.paid_from_collected
      and case when p_method = 'usd' then x.payment_method = 'usd'
        else coalesce(x.payment_source, 'game_club') = 'game_club'
          and x.payment_method is distinct from 'usd'
          and not x.paid_from_reserve
          and case when x.payment_method in ('cash', 'terminal', 'playstation') then x.payment_method else 'card' end = p_method
        end
    union all
    select d.date, d.amount
    from public.debt_payments d, bounds b
    where p_method in ('cash', 'terminal', 'card')
      and d.club_id = p_club_id and d.date >= b.lo and d.date < b.hi
      and case when d.payment_method in ('cash', 'terminal') then d.payment_method else 'card' end = p_method
    union all
    select m.date, case when m.to_method = p_method then m.to_amount else 0 end
      - case when m.from_method = p_method then m.from_amount else 0 end
    from public.money_exchanges m, bounds b
    where m.club_id = p_club_id and m.date >= b.lo and m.date < b.hi
      and (m.from_method = p_method or m.to_method = p_method)
    union all
    select r.entry_date, case r.kind when 'deposit' then -r.amount else r.amount end
    from public.owner_reserve_entries r, bounds b
    where p_method in ('cash', 'terminal', 'card', 'playstation')
      and r.club_id = p_club_id and r.source = 'game_club' and r.payment_method = p_method
      and r.period_month = b.month_start and not r.from_collected
    union all
    select c.date, -c.amount
    from public.money_collections c, bounds b
    where c.club_id = p_club_id and c.payment_method = p_method and c.date >= b.lo and c.date < b.hi
  ), collected(day, amount) as (
    select c.date, c.amount
    from public.money_collections c, bounds b
    where c.club_id = p_club_id and c.payment_method = p_method and c.date >= b.lo and c.date < b.hi
    union all
    select x.date, -x.amount
    from public.expenses x, bounds b
    where x.club_id = p_club_id and x.paid_from_collected and x.payment_method = p_method
      and x.date >= b.lo and x.date < b.hi
    union all
    select r.entry_date, -r.amount
    from public.owner_reserve_entries r, bounds b
    where r.club_id = p_club_id and r.from_collected and r.payment_method = p_method
      and r.period_month = b.month_start
  ), flows as (
    select * from till where p_holder = 'till'
    union all
    select * from collected where p_holder = 'collected' and p_method <> 'usd'
  )
  select day, sum(sum(amount)) over (order by day) as balance
  from flows group by day
$$;
revoke all on function public.method_daily_balances(uuid, text, date, text) from public, anon, authenticated;

create or replace function public.method_daily_lowest_balance(p_club_id uuid, p_method text, p_from date)
returns numeric language sql stable security definer set search_path = public as $$
  select min(balance) from public.method_daily_balances(p_club_id, p_method, p_from, 'till') where day >= p_from
$$;
revoke all on function public.method_daily_lowest_balance(uuid, text, date) from public, anon, authenticated;

create or replace function public.collected_daily_lowest_balance(p_club_id uuid, p_method text, p_from date)
returns numeric language sql stable security definer set search_path = public as $$
  select min(balance) from public.method_daily_balances(p_club_id, p_method, p_from, 'collected') where day >= p_from
$$;
revoke all on function public.collected_daily_lowest_balance(uuid, text, date) from public, anon, authenticated;

-- What a holder can still give from a day on: its balance at the end of that
-- day, capped by every later day so money a later write relies on stays put.
create or replace function public.method_spendable_from(p_club_id uuid, p_method text, p_date date, p_holder text)
returns numeric language sql stable security definer set search_path = public as $$
  with on_day as (
    select coalesce((select balance from public.method_daily_balances(p_club_id, p_method, p_date, p_holder)
      where day <= p_date order by day desc limit 1), 0) as balance
  )
  select greatest(0, least(on_day.balance, coalesce((
    select min(balance) from public.method_daily_balances(p_club_id, p_method, p_date, p_holder)
    where day >= p_date), on_day.balance)))
  from on_day
$$;
revoke all on function public.method_spendable_from(uuid, text, date, text) from public, anon, authenticated;

create or replace function public.assert_collected_never_negative(p_club_id uuid, p_method text, p_from date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lowest numeric;
begin
  if auth.uid() is null or p_club_id is null or p_method is null or p_from is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('expense_method_balance:' || p_club_id::text, 0));
  lowest := public.collected_daily_lowest_balance(p_club_id, p_method, p_from);
  if lowest < 0 then
    raise exception 'Insufficient collected money: % would be negative by %', p_method, -lowest
      using errcode = 'P0001', hint = 'COLLECTED_INSUFFICIENT';
  end if;
end;
$$;
revoke all on function public.assert_collected_never_negative(uuid, text, date) from public, anon, authenticated;

-- 146, with expenses paid from collected checked against collected money.
create or replace function public.expenses_never_negative() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  spent numeric := case when new.payment_method = 'usd' then new.usd_amount else new.amount end;
  spent_before numeric;
begin
  if tg_op = 'UPDATE' then
    spent_before := case when old.payment_method = 'usd' then old.usd_amount else old.amount end;
  end if;
  if new.paid_from_collected then
    if tg_op = 'UPDATE' and old.payment_method = new.payment_method and new.date >= old.date and spent <= spent_before then
      return null;
    end if;
    perform public.assert_collected_never_negative(new.club_id, new.payment_method, new.date);
    return null;
  end if;
  -- Paid by money that is not a Game Club method, or a shortage already gone.
  if new.cash_shortage_id is not null or new.paid_from_reserve
    or (coalesce(new.payment_source, 'game_club') <> 'game_club' and new.payment_method is distinct from 'usd') then
    return null;
  end if;
  -- A change that spends no more, from the same method, no earlier, is always fine.
  if tg_op = 'UPDATE'
    and public.expense_method_bucket(old.payment_method) = public.expense_method_bucket(new.payment_method)
    and coalesce(old.payment_source, 'game_club') = coalesce(new.payment_source, 'game_club')
    and not old.paid_from_reserve
    and old.cash_shortage_id is null
    and new.date >= old.date
    and spent <= spent_before then
    return null;
  end if;
  perform public.assert_method_never_negative(new.club_id, public.expense_method_bucket(new.payment_method), new.date);
  return null;
end;
$$;
revoke all on function public.expenses_never_negative() from public, anon, authenticated;

-- 162, with deposits from collected checked against collected money.
create or replace function public.owner_reserve_never_negative() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  entry public.owner_reserve_entries := case when tg_op = 'INSERT' then new else old end;
begin
  if entry.source <> 'game_club' or entry.payment_method not in ('cash', 'terminal', 'card', 'playstation')
    or (tg_op = 'INSERT') <> (entry.kind = 'deposit') then
    return null;
  end if;
  if entry.from_collected then
    perform public.assert_collected_never_negative(entry.club_id, entry.payment_method, entry.entry_date);
  else
    perform public.assert_method_never_negative(entry.club_id, entry.payment_method, entry.entry_date);
  end if;
  return null;
end;
$$;
revoke all on function public.owner_reserve_never_negative() from public, anon, authenticated;

-- Taking money out of the till must leave it at zero or above; giving a
-- collection back takes it out of collected money.
create or replace function public.money_collections_never_negative() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.assert_method_never_negative(new.club_id, new.payment_method, new.date);
  else
    perform public.assert_collected_never_negative(old.club_id, old.payment_method, old.date);
  end if;
  return null;
end;
$$;
revoke all on function public.money_collections_never_negative() from public, anon, authenticated;
drop trigger if exists money_collections_never_negative on public.money_collections;
create trigger money_collections_never_negative after insert or delete on public.money_collections
  for each row execute function public.money_collections_never_negative();

-- What the collect and pay-from-collected forms offer on a day, per method.
create or replace function public.get_collection_balances(p_club_id uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  result jsonb := '{}'::jsonb;
  method text;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is null then
    raise exception 'Not authorized for this club.' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'Invalid date.' using errcode = '22007';
  end if;
  foreach method in array array['cash', 'terminal', 'card', 'playstation'] loop
    result := result || jsonb_build_object(method, jsonb_build_object(
      'till', public.method_spendable_from(p_club_id, method, p_date, 'till'),
      'collected', public.method_spendable_from(p_club_id, method, p_date, 'collected')));
  end loop;
  return result;
end;
$$;
revoke all on function public.get_collection_balances(uuid, date) from public, anon;
grant execute on function public.get_collection_balances(uuid, date) to authenticated;

-- Every move of collected money between two dates, for Reports: collections
-- (positive), expenses it paid and deposits into the reserve (negative).
create or replace function public.get_collected_money_moves(p_club_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and public.current_user_club_role(p_club_id) is null then
    raise exception 'Not authorized for this club.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(moves) order by moves.date, moves.created_at, moves.id)
    from (
      select 'collect' as kind, c.request_id as id, c.date, c.payment_method as method, c.amount,
        c.comment, c.collected_by as created_by, c.created_at
      from public.money_collections c
      where c.club_id = p_club_id and c.date between p_from and p_to
      union all
      select 'expense', x.id, x.date, x.payment_method, -x.amount, x.comment, x.created_by, x.created_at
      from public.expenses x
      where x.club_id = p_club_id and x.paid_from_collected and x.date between p_from and p_to
      union all
      select 'reserve', r.id, r.entry_date, r.payment_method, -r.amount, r.comment, r.created_by, r.created_at
      from public.owner_reserve_entries r
      where r.club_id = p_club_id and r.from_collected and r.entry_date between p_from and p_to
    ) moves
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_collected_money_moves(uuid, date, date) from public, anon;
grant execute on function public.get_collected_money_moves(uuid, date, date) to authenticated;

-- A collector takes money out of the till. p_amounts maps methods to whole
-- positive sums; every row of one request is saved together or not at all.
-- Returns false when the request was already saved.
create or replace function public.collect_money(p_club_id uuid, p_request_id uuid, p_date date, p_amounts jsonb, p_comment text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  method text;
  amount numeric;
  saved int := 0;
begin
  if auth.uid() is null or not (public.current_user_can_access_club_feature(p_club_id, 'collection')
      or public.current_user_club_role(p_club_id) = 'owner') then
    raise exception 'Collection access is required to collect money.' using errcode = '42501';
  end if;
  if p_request_id is null or p_date is null or p_date < date '2000-01-01' or p_date > public.club_business_date(p_club_id) then
    raise exception 'Invalid collection date.' using errcode = '22007';
  end if;
  if p_amounts is null or jsonb_typeof(p_amounts) <> 'object' then
    raise exception 'Invalid collection amounts.' using errcode = '23514';
  end if;
  if exists (select 1 from public.money_collections where club_id = p_club_id and request_id = p_request_id) then
    return false;
  end if;
  for method, amount in select key, (value #>> '{}')::numeric from jsonb_each(p_amounts) loop
    if method not in ('cash', 'terminal', 'card', 'playstation')
      or amount is null or amount < 0 or amount <> round(amount) or amount::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Invalid collection amounts.' using errcode = '23514';
    end if;
    if amount > 0 then
      insert into public.money_collections (club_id, request_id, date, payment_method, amount, comment, collected_by)
        values (p_club_id, p_request_id, p_date, method, amount, nullif(btrim(p_comment), ''), auth.uid());
      saved := saved + 1;
    end if;
  end loop;
  if saved = 0 then
    raise exception 'Nothing to collect.' using errcode = '23514';
  end if;
  return true;
end;
$$;
revoke all on function public.collect_money(uuid, uuid, date, jsonb, text) from public, anon;
grant execute on function public.collect_money(uuid, uuid, date, jsonb, text) to authenticated;

-- An owner gives a collection back to the till (a mistake). Refused when the
-- collected money already paid for something or went into the reserve.
create or replace function public.delete_money_collection(p_club_id uuid, p_request_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can undo a collection.' using errcode = '42501';
  end if;
  delete from public.money_collections where club_id = p_club_id and request_id = p_request_id;
  return found;
end;
$$;
revoke all on function public.delete_money_collection(uuid, uuid) from public, anon;
grant execute on function public.delete_money_collection(uuid, uuid) to authenticated;

-- An owner moves collected money into the reserve. Owner profit sees an
-- ordinary deposit of the day's month (136, 162); the money comes out of
-- collected money, not the till.
create or replace function public.move_collected_to_reserve(p_club_id uuid, p_id uuid, p_date date, p_payment_method text, p_amount numeric, p_comment text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  month_start date := date_trunc('month', p_date)::date;
  existing public.owner_reserve_entries;
  available numeric;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can use the reserve.' using errcode = '42501';
  end if;
  if p_id is null or p_date is null or p_date > public.club_business_date(p_club_id)
    or p_payment_method is null or p_payment_method not in ('cash', 'terminal', 'card', 'playstation')
    or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount) or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid reserve date, payment method or amount.' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':game_club:' || month_start::text, 0));
  select * into existing from public.owner_reserve_entries where club_id = p_club_id and id = p_id;
  if found then
    if existing.kind <> 'deposit' or not existing.from_collected or existing.payment_method <> p_payment_method
      or existing.amount <> p_amount or existing.entry_date <> p_date then
      raise exception 'This request has already been used for a different reserve entry.';
    end if;
    return false;
  end if;

  available := public.owner_profit_bucket_available(p_club_id, 'game_club', p_payment_method, month_start);
  if p_amount > available then
    raise exception 'The reserve deposit (%) exceeds the available game_club balance (%) for %',
      p_amount, greatest(available, 0), month_start
      using errcode = '23514', hint = 'reserve_exceeds_available';
  end if;
  insert into public.owner_reserve_entries
    (id, club_id, kind, period_month, source, payment_method, amount, comment, entry_date, created_by, from_collected)
    values (p_id, p_club_id, 'deposit', month_start, 'game_club', p_payment_method, p_amount,
      nullif(btrim(p_comment), ''), p_date, auth.uid(), true);
  return true;
end;
$$;
revoke all on function public.move_collected_to_reserve(uuid, uuid, date, text, numeric, text) from public, anon;
grant execute on function public.move_collected_to_reserve(uuid, uuid, date, text, numeric, text) to authenticated, service_role;

-- Data: what the till held at the end of each month's last ticked day was
-- taken by the collector.
do $$
declare
  last_tick record;
  method text;
  held numeric;
begin
  for last_tick in
    select club_id, max(date) as date
    from public.daily_cash_collections
    group by club_id, date_trunc('month', date)
  loop
    if exists (select 1 from public.money_collections
        where club_id = last_tick.club_id and date_trunc('month', date) = date_trunc('month', last_tick.date)) then
      continue;
    end if;
    foreach method in array array['cash', 'terminal', 'card', 'playstation'] loop
      -- Capped by every later day of the month, so the till never reads below zero afterwards.
      held := floor(public.method_spendable_from(last_tick.club_id, method, last_tick.date, 'till'));
      if held > 0 then
        insert into public.money_collections (club_id, request_id, date, payment_method, amount, comment, collected_by, created_at)
          select last_tick.club_id, md5(last_tick.club_id::text || last_tick.date::text)::uuid, last_tick.date, method, held,
            'Ticked days before money collections', t.collected_by, t.collected_at
          from public.daily_cash_collections t
          where t.club_id = last_tick.club_id and t.date = last_tick.date;
      end if;
    end loop;
  end loop;
end;
$$;
