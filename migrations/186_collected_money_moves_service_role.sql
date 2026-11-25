-- Non-destructive: one grant, no table, row or function body changes. Re-runnable.
--
-- The daily Telegram report's caption says where the money is
-- (docs/plans/telegram-caption-money-whereabouts.md): the admin's till, the
-- collected money and the reserve. The cron reads collected money with
-- get_collected_money_moves (169) under the service role. 169 lets a caller
-- without a user session read any club, but granted execute only to
-- authenticated; grant it to the service role explicitly, as 156 does for
-- get_reserve_moves, instead of relying on default privileges.
grant execute on function public.get_collected_money_moves(uuid, date, date) to authenticated, service_role;
