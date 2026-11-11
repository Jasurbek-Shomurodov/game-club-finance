-- Collected money goes straight into the owner reserve (jamg'arma).
--
-- Ticking a business date as collected (096) now also deposits that day's Game
-- Club money into the reserve, one deposit per payment method, dated in the
-- day's month and tagged with `collection_date`. It is the same kind of deposit
-- an owner makes by hand (136): it leaves the month's owner profit and the
-- expense limit, and stays in the reserve until it is spent or returned.
--
-- A method's deposit is the day's money in it: income + debt payments
-- -/+ exchanges - Game Club expenses not paid from the reserve. A reserve
-- purchase on the day is left out because the reserve, not the day, paid it.
-- Each deposit is capped at what the month still has for that method (after
-- withdrawals and carryovers); a method with nothing left deposits nothing.
-- Bar money is not touched.
--
-- Removing the tick (owner only) removes that day's deposits, and is refused
-- when the reserve has since spent or returned that money. A collection deposit
-- cannot be deleted on its own; undo the collection instead. Days ticked before
-- this migration are not back-filled. Re-runnable.

alter table public.owner_reserve_entries add column if not exists collection_date date;
create index if not exists owner_reserve_entries_collection
  on public.owner_reserve_entries(club_id, collection_date) where collection_date is not null;

-- One business date's Game Club money in one method, before the reserve.
create or replace function public.collection_day_method_money(p_club_id uuid, p_method text, p_date date)
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare money numeric := 0;
begin
  select coalesce(sum(case p_method
      when 'cash' then coalesce(cash_income, 0)
      when 'terminal' then coalesce(terminal_income, 0)
      when 'card' then coalesce(card_income, 0)
      else coalesce(playstation_income, 0)
    end), 0)
  into money
  from public.daily_cash_entries
  where club_id = p_club_id and date = p_date;

  select money - coalesce(sum(amount), 0)
  into money
  from public.expenses
  where club_id = p_club_id
    and date = p_date
    and coalesce(payment_source, 'game_club') = 'game_club'
    and payment_method is distinct from 'usd'
    and not paid_from_reserve
    and case when payment_method in ('cash', 'terminal', 'playstation') then payment_method else 'card' end = p_method;

  if p_method <> 'playstation' then
    select money + coalesce(sum(amount), 0)
    into money
    from public.debt_payments
    where club_id = p_club_id
      and date = p_date
      and case when payment_method in ('cash', 'terminal') then payment_method else 'card' end = p_method;

    select money
      + coalesce(sum(case when to_method = p_method then to_amount else 0 end), 0)
      - coalesce(sum(case when from_method = p_method then from_amount else 0 end), 0)
    into money
    from public.money_exchanges
    where club_id = p_club_id
      and date = p_date
      and (from_method = p_method or to_method = p_method);
  end if;

  return money;
end;
$$;
revoke all on function public.collection_day_method_money(uuid, text, date) from public, anon, authenticated;

-- 096 unchanged, plus the reserve deposits for the day.
create or replace function public.mark_daily_cash_collected(p_club_id uuid, p_date date)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  month_start date := date_trunc('month', p_date)::date;
  method text;
  amount numeric;
begin
  if auth.uid() is null or not public.current_user_can_access_club_feature(p_club_id, 'collection') then
    raise exception 'Collection access is required to mark money as collected.' using errcode = '42501';
  end if;
  if p_date is null or p_date < date '2000-01-01' or p_date > public.club_business_date(p_club_id) then
    raise exception 'Invalid collection date.' using errcode = '22007';
  end if;
  insert into public.daily_cash_collections(club_id, date, collected_by)
    values (p_club_id, p_date, auth.uid())
    on conflict (club_id, date) do nothing;
  if not found then
    return false;
  end if;

  -- Same bucket lock as owner withdrawals, carryovers and manual deposits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':game_club:' || month_start::text, 0));
  foreach method in array array['cash', 'terminal', 'card', 'playstation'] loop
    amount := least(
      public.collection_day_method_money(p_club_id, method, p_date),
      public.owner_profit_bucket_available(p_club_id, 'game_club', method, month_start)
    );
    amount := floor(amount);
    if amount > 0 then
      insert into public.owner_reserve_entries
        (id, club_id, kind, period_month, source, payment_method, amount, comment, created_by, collection_date)
        values (gen_random_uuid(), p_club_id, 'deposit', month_start, 'game_club', method, amount, null, auth.uid(), p_date);
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.mark_daily_cash_collected(uuid, date) from public, anon;
grant execute on function public.mark_daily_cash_collected(uuid, date) to authenticated;

-- 096 unchanged, plus taking the day's deposits back out of the reserve.
create or replace function public.unmark_daily_cash_collected(p_club_id uuid, p_date date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare method text;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can undo a collection.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('owner_reserve:' || p_club_id::text || ':game_club', 0));
  delete from public.owner_reserve_entries where club_id = p_club_id and collection_date = p_date;
  if found then
    foreach method in array array['cash', 'terminal', 'card', 'playstation'] loop
      -- Raising rolls the delete back.
      if public.owner_reserve_balance(p_club_id, 'game_club', method) < 0 then
        raise exception 'The money collected on % has already been spent or returned from the reserve.', p_date
          using errcode = '23514', hint = 'reserve_already_used';
      end if;
    end loop;
  end if;
  delete from public.daily_cash_collections where club_id = p_club_id and date = p_date;
end;
$$;
revoke all on function public.unmark_daily_cash_collected(uuid, date) from public, anon;
grant execute on function public.unmark_daily_cash_collected(uuid, date) to authenticated;

-- 136 unchanged, except a collection deposit is undone with its collection.
create or replace function public.delete_owner_reserve_entry(p_club_id uuid, p_entry_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare entry public.owner_reserve_entries;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can use the reserve.' using errcode = '42501';
  end if;
  select * into entry from public.owner_reserve_entries where club_id = p_club_id and id = p_entry_id;
  if not found then raise exception 'Reserve entry not found.' using errcode = 'P0002'; end if;
  if entry.collection_date is not null then
    raise exception 'This deposit came from collecting %; undo that collection in Reports instead.', entry.collection_date
      using errcode = '23514', hint = 'reserve_collection_entry';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('owner_reserve:' || p_club_id::text || ':' || entry.source, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':' || entry.source || ':' || entry.period_month::text, 0));
  delete from public.owner_reserve_entries where club_id = p_club_id and id = entry.id;

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
