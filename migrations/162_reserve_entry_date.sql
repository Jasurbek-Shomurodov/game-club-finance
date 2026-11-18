-- A reserve deposit or return has a date of its own (owner_reserve_entries.entry_date).
--
-- Until now the day money moved into or out of the reserve was the day it was
-- recorded, clamped into its month (156). A purchase recorded later and dated
-- back (a PS5 bought on 11 November, entered on the 18th) then had its money
-- leave the till a week after the purchase. The owner can now pick the day.
--
--   entry_date: the business day the money moved, always inside period_month.
--   Existing rows keep the day they had (recorded day, clamped into the month);
--   new rows without a date get the same by trigger, so older app versions and
--   the RPCs' callers that pass no date are unchanged.
--   move_owner_profit_to_reserve / return_owner_reserve take an optional p_date
--   (in the chosen month, not after the club's business today).
--   get_reserve_moves, method_daily_lowest_balance and the never-negative
--   trigger use entry_date, so a deposit takes its method's money on that day.
--   get_owner_money_bundle returns entry_date.
--   Data: Matbuotchilar 17's 7 200 000 cash deposit for the PS5 is dated to the
--   purchase, 11 November 2026.
--
-- Re-runnable.

alter table public.owner_reserve_entries add column if not exists entry_date date;

update public.owner_reserve_entries
set entry_date = greatest(period_month,
  least(public.club_business_date(club_id, created_at), (period_month + interval '1 month - 1 day')::date))
where entry_date is null;

create or replace function public.fill_owner_reserve_entry_date() returns trigger
  language plpgsql set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.entry_date is null then
    new.entry_date := greatest(new.period_month,
      least(public.club_business_date(new.club_id, coalesce(new.created_at, now())),
        (new.period_month + interval '1 month - 1 day')::date));
  end if;
  return new;
end;
$function$;

drop trigger if exists fill_owner_reserve_entry_date on public.owner_reserve_entries;
create trigger fill_owner_reserve_entry_date before insert or update on public.owner_reserve_entries
  for each row execute function public.fill_owner_reserve_entry_date();

alter table public.owner_reserve_entries alter column entry_date set not null;
alter table public.owner_reserve_entries drop constraint if exists owner_reserve_entries_entry_date_in_month;
alter table public.owner_reserve_entries add constraint owner_reserve_entries_entry_date_in_month
  check (date_trunc('month', entry_date)::date = period_month);

-- The PS5 deposit, to the day of the purchase it paid for.
update public.owner_reserve_entries set entry_date = date '2026-11-11'
where id = 'd485ecf6-8c3a-449f-99c8-3a609f1886ae' and period_month = date '2026-11-01';

drop function if exists public.move_owner_profit_to_reserve(uuid, uuid, date, text, text, numeric, text);
drop function if exists public.return_owner_reserve(uuid, uuid, date, text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.move_owner_profit_to_reserve(p_club_id uuid, p_id uuid, p_period_month date, p_source text, p_payment_method text, p_amount numeric, p_comment text DEFAULT NULL::text, p_date date DEFAULT NULL::date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- The day the money moved: in the month it belongs to, and not in the future.
  if p_date is not null and (date_trunc('month', p_date)::date <> p_period_month
      or p_date > public.club_business_date(p_club_id)) then
    raise exception 'The reserve date must be in the chosen month and not in the future.' using errcode = '22008';
  end if;

  -- Same bucket lock as owner withdrawals and carryovers for the month.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':' || p_source || ':' || p_period_month::text, 0));
  select * into existing from public.owner_reserve_entries where club_id = p_club_id and id = p_id;
  if found then
    if existing.kind <> 'deposit' or existing.period_month <> p_period_month or existing.source <> p_source
      or existing.payment_method is distinct from p_payment_method or existing.amount <> p_amount
      or (p_date is not null and existing.entry_date <> p_date) then
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
  insert into public.owner_reserve_entries (id, club_id, kind, period_month, source, payment_method, amount, comment, entry_date, created_by)
    values (p_id, p_club_id, 'deposit', p_period_month, p_source, p_payment_method, p_amount, nullif(btrim(p_comment), ''), p_date, auth.uid());
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.return_owner_reserve(p_club_id uuid, p_id uuid, p_period_month date, p_source text, p_payment_method text, p_amount numeric, p_comment text DEFAULT NULL::text, p_date date DEFAULT NULL::date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- The day the money moved: in the month it belongs to, and not in the future.
  if p_date is not null and (date_trunc('month', p_date)::date <> p_period_month
      or p_date > public.club_business_date(p_club_id)) then
    raise exception 'The reserve date must be in the chosen month and not in the future.' using errcode = '22008';
  end if;

  perform public.lock_owner_reserve(p_club_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':' || p_source || ':' || p_period_month::text, 0));
  select * into existing from public.owner_reserve_entries where club_id = p_club_id and id = p_id;
  if found then
    if existing.kind <> 'return' or existing.period_month <> p_period_month or existing.source <> p_source
      or existing.payment_method is distinct from p_payment_method or existing.amount <> p_amount
      or (p_date is not null and existing.entry_date <> p_date) then
      raise exception 'This request has already been used for a different reserve entry.';
    end if;
    return false;
  end if;

  held := least(
    public.owner_reserve_bucket_net(p_club_id, p_source, p_payment_method),
    public.owner_reserve_sums_held(p_club_id));
  if p_amount > held then
    raise exception 'The reserve holds % in this money, less than %.', greatest(held, 0), p_amount
      using errcode = '23514', hint = 'reserve_insufficient';
  end if;
  insert into public.owner_reserve_entries (id, club_id, kind, period_month, source, payment_method, amount, comment, entry_date, created_by)
    values (p_id, p_club_id, 'return', p_period_month, p_source, p_payment_method, p_amount, nullif(btrim(p_comment), ''), p_date, auth.uid());
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_reserve_moves(p_club_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null and public.current_user_club_role(p_club_id) is null then
    raise exception 'Not authorized for this club.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('date', moves.date, 'source', moves.source, 'method', moves.method, 'amount', moves.amount)
      order by moves.date)
    from (
      select entries.entry_date as date,
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
$function$;

CREATE OR REPLACE FUNCTION public.method_daily_lowest_balance(p_club_id uuid, p_method text, p_from date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with bounds as (
    select
      case when p_method = 'usd' then date '-infinity' else date_trunc('month', p_from)::date end as lo,
      case when p_method = 'usd' then date 'infinity' else (date_trunc('month', p_from) + interval '1 month')::date end as hi,
      date_trunc('month', p_from)::date as month_start
  ), flows(day, amount) as (
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
    select r.entry_date,
      case r.kind when 'deposit' then -r.amount else r.amount end
    from public.owner_reserve_entries r, bounds b
    where p_method in ('cash', 'terminal', 'card', 'playstation')
      and r.club_id = p_club_id and r.source = 'game_club' and r.payment_method = p_method
      and r.period_month = b.month_start
  ), days as (
    select day, sum(sum(amount)) over (order by day) as balance
    from flows group by day
  )
  select min(balance) from days where day >= p_from
$function$;

CREATE OR REPLACE FUNCTION public.owner_reserve_never_negative()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  entry public.owner_reserve_entries := case when tg_op = 'INSERT' then new else old end;
begin
  if entry.source <> 'game_club' or entry.payment_method not in ('cash', 'terminal', 'card', 'playstation')
    or (tg_op = 'INSERT') <> (entry.kind = 'deposit') then
    return null;
  end if;
  perform public.assert_method_never_negative(
    entry.club_id, entry.payment_method,
    entry.entry_date);
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_owner_money_bundle(p_club_id uuid, p_through_date date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        select id, club_id, kind, period_month, source, payment_method, amount, comment, collection_date, entry_date, created_by, created_at
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
$function$;

revoke all on function public.move_owner_profit_to_reserve(uuid, uuid, date, text, text, numeric, text, date) from public, anon;
revoke all on function public.return_owner_reserve(uuid, uuid, date, text, text, numeric, text, date) from public, anon;
grant execute on function public.move_owner_profit_to_reserve(uuid, uuid, date, text, text, numeric, text, date) to authenticated, service_role;
grant execute on function public.return_owner_reserve(uuid, uuid, date, text, text, numeric, text, date) to authenticated, service_role;
