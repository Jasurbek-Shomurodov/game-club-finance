-- The owner reserve is a working fund, not a savings goal: the app stopped
-- reading owner_reserve_goals in 826af94, which is deployed. Drop the table and
-- the function that wrote it (both from 136). The reserve ledger, its balances
-- and its limits are unchanged. get_owner_reserve_balances is redefined with
-- the same behaviour, so migration health can tell this migration is applied.
-- Re-runnable.

drop function if exists public.set_owner_reserve_goal(uuid, text, text, numeric);
drop table if exists public.owner_reserve_goals;

create or replace function public.get_owner_reserve_balances(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  -- What the reserve holds, never a goal: the reserve is a working fund (138).
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
