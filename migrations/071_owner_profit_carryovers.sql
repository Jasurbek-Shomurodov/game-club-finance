-- Owners can move part of a month's unwithdrawn profit into the next calendar
-- month instead of withdrawing it. A carryover is a separate ledger: it is not
-- a withdrawal (salary KPI on owner withdrawals ignores it) and not earnings
-- (the month's reported earnings are unchanged). It lowers what can still be
-- taken from the source month and raises the next month by the same amount.
--
-- The withdrawal functions tracked by migration health (050/051) are left
-- untouched. Their balance checks call owner_source_earned_for_month, and the
-- 066 method check calls owner_payment_method_earned_for_month; both internal
-- helpers are redefined here to include carryovers, so every withdrawal path
-- respects moved money.

create table public.owner_profit_carryovers (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  from_month date not null,
  to_month date generated always as ((from_month + interval '1 month')::date) stored,
  source text not null,
  payment_method text,
  amount numeric not null,
  comment text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint owner_profit_carryovers_from_month_check
    check (from_month = date_trunc('month', from_month)::date),
  constraint owner_profit_carryovers_source_check
    check (source in ('game_club', 'bar')),
  -- Game Club money always moves out of one payment method into the same
  -- method next month, so per-method balances stay exact. Bar has no method.
  constraint owner_profit_carryovers_payment_method_check
    check (
      (source = 'game_club' and payment_method in ('cash', 'terminal', 'card', 'playstation'))
      or (source = 'bar' and payment_method is null)
    ),
  constraint owner_profit_carryovers_amount_check
    check (amount > 0 and amount::text not in ('NaN', 'Infinity'))
);

create index idx_owner_profit_carryovers_club_from_month
  on public.owner_profit_carryovers(club_id, source, from_month);
create index idx_owner_profit_carryovers_club_to_month
  on public.owner_profit_carryovers(club_id, source, to_month);

alter table public.owner_profit_carryovers enable row level security;

create policy "club_members_read_owner_profit_carryovers"
  on public.owner_profit_carryovers
  for select
  to authenticated
  using (club_id in (select public.current_user_readable_clubs(array['owner_profit']::text[])));

-- Writes go only through the RPCs below, which validate balances under the
-- same bucket locks as owner withdrawals. There is no update path.
revoke all on table public.owner_profit_carryovers from anon, authenticated;
grant select on table public.owner_profit_carryovers to authenticated;

-- Money available to withdraw from one source for one month, before owner
-- withdrawals: the month's earnings plus money carried in from the previous
-- month, minus money carried on to the next month. The earnings part is
-- unchanged from 029.
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

    -- Keep stock purchases and bar expenses as independent aggregates so bar
    -- expenses are deducted even when no purchase exists in this month.
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

  return earned - source_costs + carried;
end;
$$;

revoke all on function public.owner_source_earned_for_month(uuid, text, date)
  from public, anon, authenticated;

-- Game Club money in one payment method for one month, before owner
-- withdrawals, including that method's carryovers. The earnings part is
-- unchanged from 066.
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

  if p_payment_method <> 'playstation' then
    select earned + coalesce(sum(amount), 0)
    into earned
    from public.debt_payments
    where club_id = p_club_id
      and date >= month_start
      and date < next_month
      and case when payment_method in ('cash', 'terminal') then payment_method else 'card' end
        = p_payment_method;

    select earned - coalesce(sum(amount), 0)
    into earned
    from public.expenses
    where club_id = p_club_id
      and date >= month_start
      and date < next_month
      and coalesce(payment_source, 'game_club') = 'game_club'
      and case when payment_method in ('cash', 'terminal') then payment_method else 'card' end
        = p_payment_method;
  end if;

  select earned + coalesce(sum(case when to_month = month_start then amount else -amount end), 0)
  into earned
  from public.owner_profit_carryovers
  where club_id = p_club_id
    and source = 'game_club'
    and payment_method = p_payment_method
    and (to_month = month_start or from_month = month_start);

  return earned;
end;
$$;

revoke all on function public.owner_payment_method_earned_for_month(uuid, text, date)
  from public, anon, authenticated;

-- What can still be withdrawn or carried from one bucket. Callers hold the
-- bucket advisory lock. Internal helper only.
create function public.owner_profit_bucket_available(
  p_club_id uuid,
  p_source text,
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
  source_available numeric;
  method_available numeric;
begin
  select public.owner_source_earned_for_month(p_club_id, p_source, p_period_month)
    - coalesce(sum(amount), 0)
  into source_available
  from public.owner_withdrawals
  where club_id = p_club_id and source = p_source and period_month = p_period_month;

  if p_payment_method is null then
    return source_available;
  end if;

  select public.owner_payment_method_earned_for_month(p_club_id, p_payment_method, p_period_month)
    - coalesce(sum(amount), 0)
  into method_available
  from public.owner_withdrawals
  where club_id = p_club_id
    and source = 'game_club'
    and payment_method = p_payment_method
    and period_month = p_period_month;

  return least(source_available, method_available);
end;
$$;

revoke all on function public.owner_profit_bucket_available(uuid, text, text, date)
  from public, anon, authenticated;

create function public.carry_owner_profit_to_next_month(
  p_club_id uuid,
  p_from_month date,
  p_source text,
  p_payment_method text,
  p_amount numeric,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_month date := date_trunc('month', now() at time zone 'Asia/Tashkent')::date;
  available numeric;
  carryover_id uuid;
begin
  if auth.uid() is null
    or public.current_user_club_role(p_club_id) is distinct from 'owner'::public.user_role then
    raise exception 'Only a club owner can carry owner profit' using errcode = '42501';
  end if;
  if p_from_month is null or p_from_month <> date_trunc('month', p_from_month)::date
    or p_source is null or p_source not in ('game_club', 'bar')
    or (p_source = 'game_club' and (p_payment_method is null
      or p_payment_method not in ('cash', 'terminal', 'card', 'playstation')))
    or (p_source = 'bar' and p_payment_method is not null)
    or p_amount is null or p_amount <= 0 or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid carryover month, source, payment method or amount' using errcode = '23514';
  end if;
  if p_from_month > current_month then
    raise exception 'Owner profit cannot be carried from a future month' using errcode = '22008';
  end if;

  -- Same bucket lock as owner withdrawals for the source month.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':' || p_source || ':' || p_from_month::text, 0));

  available := public.owner_profit_bucket_available(p_club_id, p_source, p_payment_method, p_from_month);
  if p_amount > available then
    raise exception 'Carryover (%) exceeds the available % balance (%) for %',
      p_amount, p_source, greatest(available, 0), p_from_month
      using errcode = '23514';
  end if;

  insert into public.owner_profit_carryovers (club_id, from_month, source, payment_method, amount, comment, created_by)
  values (p_club_id, p_from_month, p_source, p_payment_method, p_amount, nullif(btrim(p_comment), ''), auth.uid())
  returning id into carryover_id;

  return carryover_id;
end;
$$;

revoke all on function public.carry_owner_profit_to_next_month(uuid, date, text, text, numeric, text)
  from public, anon;
grant execute on function public.carry_owner_profit_to_next_month(uuid, date, text, text, numeric, text)
  to authenticated;

-- Undo a carryover. Refused when the next month has already used the moved
-- money (withdrawn it or carried it further), so no month becomes overdrawn.
create function public.delete_owner_profit_carryover(
  p_club_id uuid,
  p_carryover_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  carryover public.owner_profit_carryovers%rowtype;
begin
  if auth.uid() is null
    or public.current_user_club_role(p_club_id) is distinct from 'owner'::public.user_role then
    raise exception 'Only a club owner can delete a carryover' using errcode = '42501';
  end if;

  select * into carryover
  from public.owner_profit_carryovers
  where id = p_carryover_id and club_id = p_club_id;
  if not found then
    raise exception 'Carryover not found' using errcode = 'P0002';
  end if;

  -- Lock the destination month: withdrawals and carryovers from it are
  -- serialized with this check.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':' || carryover.source || ':' || carryover.to_month::text, 0));

  delete from public.owner_profit_carryovers
  where id = carryover.id and club_id = p_club_id;

  if public.owner_profit_bucket_available(
    p_club_id, carryover.source, carryover.payment_method, carryover.to_month
  ) < 0 then
    -- Raising rolls the delete back.
    raise exception 'The carried money has already been used in %', carryover.to_month
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.delete_owner_profit_carryover(uuid, uuid) from public, anon;
grant execute on function public.delete_owner_profit_carryover(uuid, uuid) to authenticated;
