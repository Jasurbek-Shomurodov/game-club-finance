-- "All" owner withdrawals take Game Club money method by method.
--
-- withdraw_owner_money_for_month (051) takes Game Club money for 'all' as one
-- row with no payment method. That row is checked only against the whole Game
-- Club month, which still counts profit held in US dollars (092) and money no
-- method holds, so "All" could take money no method has, while every method
-- still showed its full balance.
--
-- This function takes Game Club money from cash, terminal, card and then
-- PlayStation, each up to what that method has left, and then the bar. Every
-- Game Club row names its method, so the per-method trigger (066) checks it.
-- Dollars stay in the club. The 051 function is left as it is: its body is
-- fingerprinted by the Settings health check (052) and older app versions call it.

create or replace function public.withdraw_owner_money_all_by_method(
  p_club_id uuid,
  p_period_month date,
  p_amount numeric,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  method text;
  available numeric;
  remaining numeric := p_amount;
  allocated numeric;
begin
  if auth.uid() is null
    or public.current_user_club_role(p_club_id) is distinct from 'owner'::public.user_role then
    raise exception 'Only a club owner can take owner money' using errcode = '42501';
  end if;
  if p_period_month is null or p_period_month <> date_trunc('month', p_period_month)::date
    or p_amount is null or p_amount <= 0 or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid withdrawal month or amount' using errcode = '23514';
  end if;

  -- Same bucket locks and order as 051, so the two never deadlock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':game_club:' || p_period_month::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_club_id::text || ':bar:' || p_period_month::text, 0));

  foreach method in array array['cash', 'terminal', 'card', 'playstation'] loop
    exit when remaining <= 0;
    available := public.owner_profit_bucket_available(p_club_id, 'game_club', method, p_period_month);
    allocated := least(remaining, greatest(0, available));
    if allocated > 0 then
      insert into public.owner_withdrawals (club_id, period_month, source, payment_method, amount, comment, created_by)
      values (p_club_id, p_period_month, 'game_club', method, allocated, nullif(btrim(p_comment), ''), auth.uid());
      remaining := remaining - allocated;
    end if;
  end loop;

  if remaining > 0 then
    available := public.owner_profit_bucket_available(p_club_id, 'bar', null, p_period_month);
    allocated := least(remaining, greatest(0, available));
    if allocated > 0 then
      insert into public.owner_withdrawals (club_id, period_month, source, amount, comment, created_by)
      values (p_club_id, p_period_month, 'bar', allocated, nullif(btrim(p_comment), ''), auth.uid());
      remaining := remaining - allocated;
    end if;
  end if;

  if remaining > 0 then
    -- Raising rolls back every row this call inserted.
    raise exception 'Withdrawal exceeds available profit' using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.withdraw_owner_money_all_by_method(uuid, date, numeric, text) from public, anon;
grant execute on function public.withdraw_owner_money_all_by_method(uuid, date, numeric, text) to authenticated;
