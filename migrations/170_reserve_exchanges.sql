-- Exchanges inside the owner reserve (jamg'arma): buy dollars with the
-- reserve's sums, or sell the reserve's dollars for sums, without the money
-- ever passing through owner profit.
--
-- The reserve holds one pot of sums and one of dollars (155). Its dollars are
-- the club's dollars, read from money_exchanges (143): an exchange into
-- dollars is a reserve deposit of the sums paid, one out of dollars returns the
-- sums received. Until now an owner who wanted to change reserve sums into
-- dollars had to return the money to a month's profit and then exchange it in
-- Reports: two writes, either of which could fail or be undone alone.
--
-- An exchange inside the reserve is that same pair, written atomically and
-- linked, so every existing balance, limit and report reads it unchanged:
--
--   buy dollars:  a return of the sums to the exchange month's Game Club
--                 profit in one method (cash, terminal or card), then an
--                 exchange from that method into dollars. The method, the
--                 month and the reserve total are unchanged; the reserve's sums
--                 go down and its dollars go up.
--   sell dollars: an exchange from dollars into one method, then a deposit of
--                 the sums received from that method back into the reserve.
--
--   owner_reserve_entries.paired_exchange_id: the exchange the entry is the
--     sums half of. Deleting the exchange deletes the entry with it.
--   exchange_owner_reserve: records both halves (owner only, idempotent by the
--     exchange id). A buy is limited like a return (the method's savings and
--     the reserve's sums); a sell by the dollars held (144).
--   delete_owner_reserve_exchange: undoes both halves, refused when the
--     dollars bought or the sums received were already spent.
--   delete_money_exchange undoes the pair when given its exchange (Reports);
--   delete_owner_reserve_entry refuses the sums half alone.
--   get_owner_money_bundle returns every reserve entry column.
--
-- Re-runnable.

alter table public.owner_reserve_entries add column if not exists paired_exchange_id uuid;

alter table public.owner_reserve_entries drop constraint if exists owner_reserve_entries_paired_exchange_fkey;
alter table public.owner_reserve_entries add constraint owner_reserve_entries_paired_exchange_fkey
  foreign key (club_id, paired_exchange_id) references public.money_exchanges(club_id, id)
  on delete cascade deferrable initially deferred;

create unique index if not exists owner_reserve_entries_paired_exchange
  on public.owner_reserve_entries(paired_exchange_id) where paired_exchange_id is not null;

create or replace function public.exchange_owner_reserve(
  p_club_id uuid, p_id uuid, p_entry_id uuid, p_date date, p_direction text, p_method text,
  p_amount numeric, p_rate numeric, p_comment text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_month date := date_trunc('month', p_date)::date;
  v_comment text := btrim(coalesce(p_comment, ''));
  v_sums numeric;
  v_usd numeric;
  v_kind text := case p_direction when 'buy' then 'return' else 'deposit' end;
  limit_amount numeric;
  methods text[];
  existing public.money_exchanges;
  existing_entry public.owner_reserve_entries;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can use the reserve.' using errcode = '42501';
  end if;
  if p_id is null or p_entry_id is null or p_id = p_entry_id
    or p_date is null or p_date < date '2000-01-01'
    or p_direction is null or p_direction not in ('buy', 'sell')
    or p_method is null or p_method not in ('cash', 'terminal', 'card')
    or p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity') or p_amount <= 0
    or p_rate is null or p_rate::text in ('NaN', 'Infinity', '-Infinity') or p_rate <= 0 or p_rate <> round(p_rate, 2)
    or p_amount >= 100000000000000 or p_rate >= 100000000000000
    or length(v_comment) > 300 then
    raise exception 'Invalid reserve exchange.' using errcode = '23514';
  end if;
  -- A buy is typed in sums (whole), a sell in dollars (cents).
  if (p_direction = 'buy' and p_amount <> round(p_amount)) or (p_direction = 'sell' and p_amount <> round(p_amount, 2)) then
    raise exception 'Invalid reserve exchange.' using errcode = '23514';
  end if;
  if p_date > public.club_business_date(p_club_id) then
    raise exception 'A reserve exchange cannot be dated in the future.' using errcode = '22008';
  end if;

  select enabled_payment_methods into methods from public.clubs where id = p_club_id;
  if not (p_method = any(coalesce(methods, array['cash', 'terminal', 'card']))) then
    raise exception 'Payment method is not enabled for this club.';
  end if;

  -- Same rounding as record_money_exchange (092).
  if p_direction = 'buy' then
    v_sums := p_amount;
    v_usd := round(p_amount / p_rate, 2);
  else
    v_usd := p_amount;
    v_sums := round(p_amount * p_rate);
  end if;
  if v_sums <= 0 or v_usd <= 0 then
    raise exception 'Invalid reserve exchange.' using errcode = '23514';
  end if;

  perform public.lock_owner_reserve(p_club_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':game_club:' || v_month::text, 0));

  -- A retried request is recorded once; a reused id for something else is refused.
  select * into existing from public.money_exchanges where id = p_id;
  select * into existing_entry from public.owner_reserve_entries where id = p_entry_id;
  if existing.id is not null or existing_entry.id is not null then
    if existing.id is null or existing_entry.id is null
      or existing.club_id <> p_club_id or existing_entry.paired_exchange_id is distinct from p_id
      or existing.date <> p_date or existing.rate is distinct from p_rate
      or existing_entry.payment_method is distinct from p_method
      or existing_entry.kind <> v_kind
      or (p_direction = 'buy' and existing.from_amount <> v_sums)
      or (p_direction = 'sell' and existing.from_amount <> v_usd) then
      raise exception 'This request has already been used for a different exchange.' using errcode = '23505';
    end if;
    return false;
  end if;

  if p_direction = 'buy' then
    -- Limited like a return: the method's savings and the reserve's sums.
    limit_amount := least(
      public.owner_reserve_bucket_net(p_club_id, 'game_club', p_method),
      public.owner_reserve_sums_held(p_club_id));
    if v_sums > limit_amount then
      raise exception 'The reserve holds % in this money, less than %.', greatest(limit_amount, 0), v_sums
        using errcode = '23514', hint = 'reserve_insufficient';
    end if;
    -- The return first, so the method holds the sums the exchange then takes.
    insert into public.owner_reserve_entries
      (id, club_id, kind, period_month, source, payment_method, amount, comment, entry_date, paired_exchange_id, created_by)
      values (p_entry_id, p_club_id, 'return', v_month, 'game_club', p_method, v_sums, nullif(v_comment, ''), p_date, p_id, auth.uid());
    insert into public.money_exchanges (id, club_id, date, from_method, to_method, from_amount, to_amount, rate, comment, created_by)
      values (p_id, p_club_id, p_date, p_method, 'usd', v_sums, v_usd, p_rate, v_comment, auth.uid());
  else
    -- The 144 trigger limits the dollars sold to the dollars held.
    insert into public.money_exchanges (id, club_id, date, from_method, to_method, from_amount, to_amount, rate, comment, created_by)
      values (p_id, p_club_id, p_date, 'usd', p_method, v_usd, v_sums, p_rate, v_comment, auth.uid());
    limit_amount := public.owner_profit_bucket_available(p_club_id, 'game_club', p_method, v_month);
    if v_sums > limit_amount then
      raise exception 'The reserve deposit (%) exceeds the available game_club balance (%) for %',
        v_sums, greatest(limit_amount, 0), v_month
        using errcode = '23514', hint = 'reserve_exceeds_available';
    end if;
    insert into public.owner_reserve_entries
      (id, club_id, kind, period_month, source, payment_method, amount, comment, entry_date, paired_exchange_id, created_by)
      values (p_entry_id, p_club_id, 'deposit', v_month, 'game_club', p_method, v_sums, nullif(v_comment, ''), p_date, p_id, auth.uid());
  end if;
  return true;
end;
$$;
revoke all on function public.exchange_owner_reserve(uuid, uuid, uuid, date, text, text, numeric, numeric, text) from public, anon;
grant execute on function public.exchange_owner_reserve(uuid, uuid, uuid, date, text, text, numeric, numeric, text) to authenticated, service_role;

create or replace function public.delete_owner_reserve_exchange(p_club_id uuid, p_exchange_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  entry public.owner_reserve_entries;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can use the reserve.' using errcode = '42501';
  end if;
  select * into entry from public.owner_reserve_entries
    where club_id = p_club_id and paired_exchange_id = p_exchange_id;
  if not found then raise exception 'Reserve exchange not found.' using errcode = 'P0002'; end if;

  perform public.lock_owner_reserve(p_club_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':game_club:' || entry.period_month::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('expense_method_balance:' || p_club_id::text, 0));

  -- Each half goes in the order that never leaves its method short on a day
  -- (146): a buy's dollars before the sums returned for them, a sell's sums
  -- deposited before the dollars sold for them.
  if entry.kind = 'return' then
    delete from public.money_exchanges where club_id = p_club_id and id = p_exchange_id;
    delete from public.owner_reserve_entries where club_id = p_club_id and id = entry.id;
  else
    delete from public.owner_reserve_entries where club_id = p_club_id and id = entry.id;
    delete from public.money_exchanges where club_id = p_club_id and id = p_exchange_id;
  end if;

  if public.owner_reserve_bucket_net(p_club_id, 'game_club', entry.payment_method) < 0
    or public.owner_reserve_sums_held(p_club_id) < 0
    or public.owner_profit_bucket_available(p_club_id, 'game_club', entry.payment_method, entry.period_month) < 0
    or public.expense_method_balance(p_club_id, 'usd', public.club_business_date(p_club_id)) < 0 then
    raise exception 'This reserve money has already been spent or returned.'
      using errcode = '23514', hint = 'reserve_already_used';
  end if;
end;
$$;
revoke all on function public.delete_owner_reserve_exchange(uuid, uuid) from public, anon;
grant execute on function public.delete_owner_reserve_exchange(uuid, uuid) to authenticated, service_role;

-- 145, except an exchange made inside the reserve is undone with its sums half.
create or replace function public.delete_money_exchange(p_club_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  existing public.money_exchanges;
  available numeric;
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can delete an exchange.' using errcode = '42501';
  end if;

  if exists (select 1 from public.owner_reserve_entries where club_id = p_club_id and paired_exchange_id = p_id) then
    perform public.delete_owner_reserve_exchange(p_club_id, p_id);
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('expense_method_balance:' || p_club_id::text, 0));
  select * into existing from public.money_exchanges where club_id = p_club_id and id = p_id for update;
  if not found then raise exception 'Exchange does not belong to this club.' using errcode = 'P0002'; end if;

  available := public.expense_method_balance(p_club_id, existing.to_method, existing.date);
  if existing.to_amount > available then
    raise exception 'Insufficient payment method balance: % available', available
      using errcode = 'P0001', hint = 'INSUFFICIENT_BALANCE';
  end if;

  delete from public.money_exchanges where id = existing.id;
end;
$$;
revoke all on function public.delete_money_exchange(uuid,uuid) from public, anon;
grant execute on function public.delete_money_exchange(uuid,uuid) to authenticated;

-- 155, except the sums half of a reserve exchange is undone only with its exchange.
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
  if entry.paired_exchange_id is not null then
    raise exception 'This entry is half of a reserve exchange; undo the exchange instead.'
      using errcode = '23514', hint = 'reserve_exchange_entry';
  end if;

  perform public.lock_owner_reserve(p_club_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':' || entry.source || ':' || entry.period_month::text, 0));
  delete from public.owner_reserve_entries where club_id = p_club_id and id = entry.id;

  if public.owner_reserve_bucket_net(p_club_id, entry.source, entry.payment_method) < 0
    or public.owner_reserve_sums_held(p_club_id) < 0 then
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

-- 162, except reserve entries come back with every column, paired_exchange_id included.
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
      from public.owner_reserve_entries rows
      where rows.club_id = p_club_id
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
