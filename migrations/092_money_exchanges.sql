-- Money exchanges move Game Club money between payment methods (cash,
-- terminal, card) or into and out of US dollars at a rate the user enters.
-- An exchange is neither income nor an expense: it lowers the "from" method
-- and raises the "to" method by the converted amount. Dollars are their own
-- holding, never added to sum amounts.
--
-- Writes go only through the RPCs below. Deleting is owner-only, like
-- expenses. Each exchange remembers its club-group Telegram message so
-- deleting it removes that message. Re-runnable.

create table if not exists public.money_exchanges (
  id uuid primary key, -- caller's retry/idempotency key
  club_id uuid not null references public.clubs(id),
  date date not null,
  from_method text not null check (from_method in ('cash', 'terminal', 'card', 'usd')),
  to_method text not null check (to_method in ('cash', 'terminal', 'card', 'usd')),
  from_amount numeric(16,2) not null check (from_amount > 0 and from_amount < 100000000000000),
  to_amount numeric(16,2) not null check (to_amount > 0 and to_amount < 100000000000000),
  -- UZS per one US dollar; only for exchanges into or out of dollars.
  rate numeric(16,2) check (rate is null or (rate > 0 and rate < 100000000000000)),
  comment text not null default '' check (length(comment) <= 300),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  telegram_chat_id text,
  telegram_message_id bigint,
  unique (club_id, id),
  constraint money_exchanges_distinct_methods check (from_method <> to_method),
  constraint money_exchanges_rate_only_for_usd check ((rate is not null) = (from_method = 'usd' or to_method = 'usd')),
  constraint money_exchanges_same_amount_without_usd check (from_method = 'usd' or to_method = 'usd' or from_amount = to_amount),
  constraint money_exchanges_telegram_message_coordinates_check check (
    (telegram_chat_id is null and telegram_message_id is null)
    or (nullif(btrim(telegram_chat_id), '') is not null and telegram_message_id > 0)
  )
);
create index if not exists money_exchanges_club_date on public.money_exchanges(club_id, date);

alter table public.money_exchanges enable row level security;
revoke all on public.money_exchanges from public, anon, authenticated;
grant select on public.money_exchanges to authenticated;
drop policy if exists money_exchanges_member_read on public.money_exchanges;
create policy money_exchanges_member_read on public.money_exchanges for select to authenticated
  using (club_id in (select public.current_user_readable_clubs(array['dashboard', 'expenses', 'reports', 'owner_profit']::text[])));

create or replace function public.record_money_exchange(
  p_id uuid, p_club_id uuid, p_date date, p_from_method text, p_to_method text,
  p_from_amount numeric, p_rate numeric, p_comment text
) returns table(exchange_id uuid, created boolean)
language plpgsql security definer set search_path = public as $$
declare
  existing public.money_exchanges;
  methods text[];
  v_rate numeric := case when p_from_method = 'usd' or p_to_method = 'usd' then p_rate end;
  v_comment text := btrim(coalesce(p_comment, ''));
  v_to_amount numeric;
begin
  if auth.uid() is null or not public.current_user_can_access_club_feature(p_club_id, 'expenses') then
    raise exception 'Expense access is required to exchange money.' using errcode = '42501';
  end if;
  if p_id is null or p_date is null or p_date < date '2000-01-01' or p_date > public.club_business_date(p_club_id)
    or p_from_method is null or p_to_method is null or p_from_method = p_to_method
    or p_from_method not in ('cash', 'terminal', 'card', 'usd') or p_to_method not in ('cash', 'terminal', 'card', 'usd')
    or p_from_amount is null or p_from_amount::text in ('NaN', 'Infinity', '-Infinity') or p_from_amount <= 0
    or p_from_amount <> round(p_from_amount, 2)
    or ((p_from_method = 'usd' or p_to_method = 'usd') and (v_rate is null or v_rate::text in ('NaN', 'Infinity', '-Infinity') or v_rate <= 0 or v_rate <> round(v_rate, 2)))
    or length(v_comment) > 300 then
    raise exception 'Invalid money exchange.';
  end if;
  -- UZS amounts are whole sums; dollars keep cents.
  if p_from_method <> 'usd' and p_from_amount <> round(p_from_amount) then
    raise exception 'Invalid money exchange.';
  end if;

  select * into existing from public.money_exchanges where id = p_id;
  if found then
    if existing.club_id is distinct from p_club_id or existing.date is distinct from p_date
      or existing.from_method is distinct from p_from_method or existing.to_method is distinct from p_to_method
      or existing.from_amount is distinct from p_from_amount or existing.rate is distinct from v_rate
      or existing.comment is distinct from v_comment then
      raise exception 'This request has already been used for a different exchange.' using errcode = '23505';
    end if;
    return query select existing.id, false;
    return;
  end if;

  select enabled_payment_methods into methods from public.clubs where id = p_club_id;
  if (p_from_method <> 'usd' and not (p_from_method = any(coalesce(methods, array['cash', 'terminal', 'card']))))
    or (p_to_method <> 'usd' and not (p_to_method = any(coalesce(methods, array['cash', 'terminal', 'card'])))) then
    raise exception 'Payment method is not enabled for this club.';
  end if;

  v_to_amount := case
    when p_to_method = 'usd' then round(p_from_amount / v_rate, 2)
    when p_from_method = 'usd' then round(p_from_amount * v_rate)
    else p_from_amount
  end;
  if v_to_amount <= 0 then raise exception 'Invalid money exchange.'; end if;

  insert into public.money_exchanges(id, club_id, date, from_method, to_method, from_amount, to_amount, rate, comment, created_by)
    values (p_id, p_club_id, p_date, p_from_method, p_to_method, p_from_amount, v_to_amount, v_rate, v_comment, auth.uid());
  return query select p_id, true;
end;
$$;
revoke all on function public.record_money_exchange(uuid,uuid,date,text,text,numeric,numeric,text) from public, anon;
grant execute on function public.record_money_exchange(uuid,uuid,date,text,text,numeric,numeric,text) to authenticated;

create or replace function public.set_money_exchange_telegram_message(
  p_club_id uuid, p_id uuid, p_chat_id text, p_message_id bigint
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.current_user_can_access_club_feature(p_club_id, 'expenses') then
    raise exception 'Expense access is required.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_chat_id, '')), '') is null or p_message_id is null or p_message_id <= 0 then
    raise exception 'Invalid Telegram message.';
  end if;
  update public.money_exchanges set telegram_chat_id = btrim(p_chat_id), telegram_message_id = p_message_id
    where club_id = p_club_id and id = p_id and telegram_message_id is null;
end;
$$;
revoke all on function public.set_money_exchange_telegram_message(uuid,uuid,text,bigint) from public, anon;
grant execute on function public.set_money_exchange_telegram_message(uuid,uuid,text,bigint) to authenticated;

create or replace function public.delete_money_exchange(p_club_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can delete an exchange.' using errcode = '42501';
  end if;
  delete from public.money_exchanges where club_id = p_club_id and id = p_id;
  if not found then raise exception 'Exchange does not belong to this club.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.delete_money_exchange(uuid,uuid) from public, anon;
grant execute on function public.delete_money_exchange(uuid,uuid) to authenticated;

-- Per-method owner withdrawal limits follow exchanges: unchanged from 071
-- except the exchange step. Dollars are not a withdrawal method.
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

  return earned;
end;
$$;

revoke all on function public.owner_payment_method_earned_for_month(uuid, text, date)
  from public, anon, authenticated;
