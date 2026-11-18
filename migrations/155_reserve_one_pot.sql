-- The owner reserve (jamg'arma) pays as one pot of sums and one of dollars.
--
-- 136 kept the reserve per side (Game Club, Bar) and, on the Game Club side,
-- per payment method, and a reserve purchase had to fit in the one bucket it
-- named. The reserve is the owner's own money, apart from Game Club and Bar:
-- it holds sums and dollars (143), nothing else. From now on:
--
--   a purchase paid from the reserve's sums is limited by everything the
--   reserve holds in sums, whatever side or method the money was saved from;
--   it is recorded on the Game Club side in cash (payment_method must name a
--   method), which only says where the row lives, not which bucket paid;
--   a return still names the month and method it goes back to, and is limited
--   both by what was saved there and by the sums the reserve still holds;
--   undoing a deposit is refused when that bucket was already returned or the
--   reserve's sums would go below zero.
--
-- Dollars stay as 143 made them: a dollar expense is a reserve purchase,
-- limited by expense_method_balance('usd'). Deposits still leave a month's
-- owner profit per side and method (136), so the month accounting is unchanged.
-- Every reserve check takes the Game Club lock, then the Bar lock. Re-runnable.

-- Sums the reserve holds now: both sides, every method but dollars.
create or replace function public.owner_reserve_sums_held(p_club_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select public.owner_reserve_balance(p_club_id, 'game_club', null)
    - public.owner_reserve_balance(p_club_id, 'game_club', 'usd')
    + public.owner_reserve_balance(p_club_id, 'bar', null)
$$;
revoke all on function public.owner_reserve_sums_held(uuid) from public, anon, authenticated;

-- Saved minus returned in one bucket; purchases come out of the pot, not a bucket.
create or replace function public.owner_reserve_bucket_net(p_club_id uuid, p_source text, p_payment_method text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when kind = 'deposit' then amount else -amount end), 0)
    from public.owner_reserve_entries
    where club_id = p_club_id and source = p_source
      and payment_method is not distinct from p_payment_method
$$;
revoke all on function public.owner_reserve_bucket_net(uuid, text, text) from public, anon, authenticated;

create or replace function public.lock_owner_reserve(p_club_id uuid)
returns void language sql security definer set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('owner_reserve:' || p_club_id::text || ':game_club', 0));
  select pg_advisory_xact_lock(hashtextextended('owner_reserve:' || p_club_id::text || ':bar', 0));
$$;
revoke all on function public.lock_owner_reserve(uuid) from public, anon, authenticated;

-- 136, except the purchase is limited by the reserve's sums, not one bucket.
create or replace function public.guard_reserve_expense() returns trigger
language plpgsql security definer set search_path = public as $$
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
  perform public.lock_owner_reserve(NEW.club_id);
  if NEW.amount > public.owner_reserve_sums_held(NEW.club_id) then
    raise exception 'The reserve holds less than this purchase.' using errcode = '23514', hint = 'reserve_insufficient';
  end if;
  return NEW;
end;
$$;
revoke all on function public.guard_reserve_expense() from public, anon, authenticated;

-- 136, except the return is limited by its bucket's savings and the reserve's sums.
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

  perform public.lock_owner_reserve(p_club_id);
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

  held := least(
    public.owner_reserve_bucket_net(p_club_id, p_source, p_payment_method),
    public.owner_reserve_sums_held(p_club_id));
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

-- 137, except the money counts as used when its bucket was returned or the pot is spent.
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

-- 143, plus the reserve's sums as one pot for the expense form.
create or replace function public.get_owner_reserve_balances(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can see the reserve.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'sums', public.owner_reserve_sums_held(p_club_id),
    'game_club', jsonb_build_object(
      'total', public.owner_reserve_balance(p_club_id, 'game_club', null),
      'cash', public.owner_reserve_balance(p_club_id, 'game_club', 'cash'),
      'terminal', public.owner_reserve_balance(p_club_id, 'game_club', 'terminal'),
      'card', public.owner_reserve_balance(p_club_id, 'game_club', 'card'),
      'playstation', public.owner_reserve_balance(p_club_id, 'game_club', 'playstation'),
      'usd', public.owner_reserve_balance(p_club_id, 'game_club', 'usd'),
      'usd_held', public.expense_method_balance(p_club_id, 'usd', public.club_business_date(p_club_id))
    ),
    'bar', jsonb_build_object('total', public.owner_reserve_balance(p_club_id, 'bar', null))
  );
end;
$$;
revoke all on function public.get_owner_reserve_balances(uuid) from public, anon;
grant execute on function public.get_owner_reserve_balances(uuid) to authenticated;
