-- Collecting a day no longer touches the owner reserve (jamg'arma).
--
-- 137 (and its back-fill 139) deposited a collected day's Game Club money into
-- the reserve. The reserve now changes only when the owner moves owner profit
-- into it or takes it back (136), when money is exchanged into or out of
-- dollars (143), or when it pays for a purchase. Collecting only closes the
-- day (096, 097), as before 137.
--
-- Every existing collection deposit is removed, so that money is owner profit
-- of its month again. The migration refuses to run if that would leave a
-- reserve method below zero (the reserve already spent or returned it).
-- `collection_date` stays for older clients and always reads null from now on.
-- Re-runnable.

create or replace function public.mark_daily_cash_collected(p_club_id uuid, p_date date)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.current_user_can_access_club_feature(p_club_id, 'collection') then
    raise exception 'Collection access is required to mark money as collected.' using errcode = '42501';
  end if;
  if p_date is null or p_date < date '2000-01-01' or p_date > public.club_business_date(p_club_id) then
    raise exception 'Invalid collection date.' using errcode = '22007';
  end if;
  -- 148: collecting only closes the day; it never deposits into the reserve.
  insert into public.daily_cash_collections(club_id, date, collected_by)
    values (p_club_id, p_date, auth.uid())
    on conflict (club_id, date) do nothing;
  return found;
end;
$$;
revoke all on function public.mark_daily_cash_collected(uuid, date) from public, anon;
grant execute on function public.mark_daily_cash_collected(uuid, date) to authenticated;

create or replace function public.unmark_daily_cash_collected(p_club_id uuid, p_date date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can undo a collection.' using errcode = '42501';
  end if;
  -- 148: no collection deposits exist, so the reserve is not touched.
  delete from public.daily_cash_collections where club_id = p_club_id and date = p_date;
end;
$$;
revoke all on function public.unmark_daily_cash_collected(uuid, date) from public, anon;
grant execute on function public.unmark_daily_cash_collected(uuid, date) to authenticated;

do $$
declare
  bucket record;
begin
  for bucket in
    select distinct club_id, payment_method
    from public.owner_reserve_entries
    where collection_date is not null
    order by club_id, payment_method
  loop
    perform pg_advisory_xact_lock(hashtextextended('owner_reserve:' || bucket.club_id::text || ':game_club', 0));
  end loop;

  delete from public.owner_reserve_entries where collection_date is not null;

  for bucket in
    select clubs.id as club_id, methods.method
    from public.clubs clubs
    cross join unnest(array['cash', 'terminal', 'card', 'playstation']) as methods(method)
  loop
    if public.owner_reserve_balance(bucket.club_id, 'game_club', bucket.method) < 0 then
      raise exception 'Club % already spent or returned collected % money from the reserve.', bucket.club_id, bucket.method
        using errcode = '23514', hint = 'reserve_already_used';
    end if;
  end loop;
end;
$$;
