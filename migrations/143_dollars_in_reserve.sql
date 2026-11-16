-- Dollars go straight into the owner reserve (jamg'arma).
--
-- Money exchanged into US dollars (092) left the payment methods but stayed in
-- the month's Game Club owner profit, where it could be neither withdrawn nor
-- reserved. From now on the reserve holds the club's dollars:
--
--   an exchange into dollars is a reserve deposit of the sums paid, in the
--   exchange's month;
--   an exchange out of dollars returns the sums received to that month's
--   owner profit (they land in the cash, terminal or card it names);
--   an expense paid in dollars (124) is a reserve purchase: it still counts in
--   every expense total, but the reserve, not the month, pays for it.
--
-- Nothing is written: the reserve reads these straight from money_exchanges
-- and expenses, so every past exchange counts at once, and deleting an
-- exchange or a dollar expense takes it out of the reserve with it. They show
-- as the reserve's "usd" method. The sums value of the dollars is what was
-- paid and received, never a current rate; the dollars themselves stay limited
-- by expense_method_balance('usd') (124). Dollars cannot be returned or
-- deposited by hand: an exchange does that. Re-runnable.

-- The Game Club method a reserve purchase draws on; dollars are their own.
create or replace function public.reserve_expense_method(p_source text, p_method text)
returns text language sql immutable set search_path = public as $$
  select case when coalesce(p_source, 'game_club') <> 'game_club' then null
    when p_method in ('cash', 'terminal', 'playstation', 'usd') then p_method else 'card' end
$$;
revoke all on function public.reserve_expense_method(text, text) from public, anon, authenticated;

-- Sums moved into the reserve's dollars by exchanges: paid for dollars minus
-- received for them. A null month means all time.
create or replace function public.owner_reserve_dollar_exchanges(p_club_id uuid, p_month date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when to_method = 'usd' then from_amount else -to_amount end), 0)
  from public.money_exchanges
  where club_id = p_club_id
    and (to_method = 'usd' or from_method = 'usd')
    and (p_month is null or (
      date >= date_trunc('month', p_month)::date
      and date < (date_trunc('month', p_month) + interval '1 month')::date))
$$;
revoke all on function public.owner_reserve_dollar_exchanges(uuid, date) from public, anon, authenticated;

-- 136, plus dollars: exchanges into dollars are deposits, and dollar expenses are reserve purchases.
create or replace function public.owner_reserve_balance(p_club_id uuid, p_source text, p_payment_method text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((
      select sum(case kind when 'deposit' then amount else -amount end)
      from public.owner_reserve_entries
      where club_id = p_club_id and source = p_source
        and (p_payment_method is null or payment_method = p_payment_method)
    ), 0)
    + case when p_source = 'game_club' and (p_payment_method is null or p_payment_method = 'usd')
      then public.owner_reserve_dollar_exchanges(p_club_id, null) else 0 end
    - coalesce((
      select sum(amount) from public.expenses
      where club_id = p_club_id and (paid_from_reserve or payment_method = 'usd')
        and coalesce(payment_source, 'game_club') = p_source
        and (p_payment_method is null or public.reserve_expense_method(payment_source, payment_method) = p_payment_method)
    ), 0)
$$;
revoke all on function public.owner_reserve_balance(uuid, text, text) from public, anon, authenticated;

-- 136, plus dollars: the month's exchanges into dollars leave its owner profit,
-- exchanges out of them come back, and its dollar expenses are given back.
create or replace function public.owner_reserve_month_effect(
  p_club_id uuid, p_source text, p_payment_method text, p_month date
) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((
      select sum(case kind when 'deposit' then -amount else amount end)
      from public.owner_reserve_entries
      where club_id = p_club_id and source = p_source and period_month = date_trunc('month', p_month)::date
        and (p_payment_method is null or payment_method = p_payment_method)
    ), 0)
    - case when p_source = 'game_club' and (p_payment_method is null or p_payment_method = 'usd')
      then public.owner_reserve_dollar_exchanges(p_club_id, p_month) else 0 end
    + coalesce((
      select sum(amount) from public.expenses
      where club_id = p_club_id and (paid_from_reserve or payment_method = 'usd')
        and coalesce(payment_source, 'game_club') = p_source
        and date >= date_trunc('month', p_month)::date
        and date < (date_trunc('month', p_month) + interval '1 month')::date
        and (p_payment_method is null or public.reserve_expense_method(payment_source, payment_method) = p_payment_method)
    ), 0)
$$;
revoke all on function public.owner_reserve_month_effect(uuid, text, text, date) from public, anon, authenticated;

-- 136, plus the dollars the reserve holds: in sums, and in dollars.
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
