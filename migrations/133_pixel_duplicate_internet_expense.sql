-- Pixel Gaming recorded the 12 Oct 2026 internet bill twice (650 000 cash
-- each): once by the admin at 18:28 with no note, and again at 19:25 with the
-- note "Internet Izzat aka to'lagan". The owner asked to delete the 18:28 row.
--
-- 12 Oct is a collected (closed) day, so the collection tick is removed, the
-- duplicate deleted, and the tick restored with its original collector and
-- time. The deletion goes through the normal triggers, so entry_audit_logs keeps
-- the deleted row. Re-runnable: does nothing once the row is gone.

do $$
declare
  v_club constant uuid := '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305';
  v_expense constant uuid := '6855e187-7269-4a6f-a479-6478d58c38be';
  v_tick public.daily_cash_collections%rowtype;
begin
  if not exists (
    select 1 from public.expenses
    where id = v_expense and club_id = v_club and date = date '2026-10-12'
      and category = 'internet' and amount = 650000 and salary_entry_id is null
  ) then
    return;
  end if;

  select * into v_tick from public.daily_cash_collections
  where club_id = v_club and date = date '2026-10-12';

  delete from public.daily_cash_collections where club_id = v_club and date = date '2026-10-12';
  delete from public.expenses where id = v_expense;
  if v_tick.club_id is not null then
    insert into public.daily_cash_collections select v_tick.*;
  end if;
end $$;
