-- A daily cash entry's author and creation time are facts of the insert, never
-- values the browser chooses or later rewrites. Mirrors 075 (new_debts):
-- created_by defaults to auth.uid() and the insert policy requires it to be the
-- signed-in user. The admin 15-minute edit window (033) is measured from
-- created_at, so an update trigger keeps created_at and created_by fixed;
-- otherwise an admin could PATCH created_at = now() and edit indefinitely.
-- Older clients that send their own user id still pass. Re-runnable.

alter table public.daily_cash_entries
  alter column created_by set default auth.uid();

drop policy if exists "club_admin_insert_cash_entries" on public.daily_cash_entries;
create policy "club_admin_insert_cash_entries" on public.daily_cash_entries
  for insert with check (
    public.current_user_club_role(club_id) in ('admin', 'owner')
    and public.current_user_can_access_club_feature(club_id, 'daily_cash')
    and created_by = auth.uid()
  );

create or replace function public.keep_daily_cash_entry_origin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end;
$$;

drop trigger if exists keep_daily_cash_entry_origin on public.daily_cash_entries;
create trigger keep_daily_cash_entry_origin
  before update on public.daily_cash_entries
  for each row execute function public.keep_daily_cash_entry_origin();
