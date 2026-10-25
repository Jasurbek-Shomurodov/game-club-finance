-- A collector ticks a business date in Reports once they have taken that
-- day's money. The tick is final for the collector: only an owner can remove
-- it. "collection" is a new feature key that owners grant explicitly, so role
-- defaults (NULL feature_access) do not change. Writes go through security
-- definer RPCs; browser roles may only read. Re-runnable.

alter table public.club_memberships
  drop constraint if exists club_memberships_feature_access_valid;

alter table public.club_memberships
  add constraint club_memberships_feature_access_valid
  check (
    feature_access is null
    or feature_access <@ array[
      'dashboard',
      'daily_cash',
      'closing_stock',
      'stock_purchase',
      'expenses',
      'reports',
      'owner_profit',
      'debts',
      'inventory',
      'salaries',
      'assistant',
      'collection',
      'team',
      'settings'
    ]::text[]
  );

create table if not exists public.daily_cash_collections (
  club_id uuid not null references public.clubs(id) on delete cascade,
  date date not null,
  collected_by uuid not null default auth.uid() references auth.users(id),
  collected_at timestamptz not null default now(),
  primary key (club_id, date)
);

alter table public.daily_cash_collections enable row level security;
revoke all on public.daily_cash_collections from public, anon, authenticated;
grant select on public.daily_cash_collections to authenticated;
drop policy if exists daily_cash_collections_member_read on public.daily_cash_collections;
create policy daily_cash_collections_member_read on public.daily_cash_collections for select to authenticated
  using (club_id in (select public.current_user_readable_clubs(array['reports', 'expenses', 'collection']::text[])));

-- Returns true when this call ticked the date, false when it was already ticked.
create or replace function public.mark_daily_cash_collected(p_club_id uuid, p_date date)
returns boolean language plpgsql security definer set search_path = public as $$
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
  return found;
end;
$$;
revoke all on function public.mark_daily_cash_collected(uuid, date) from public, anon;
grant execute on function public.mark_daily_cash_collected(uuid, date) to authenticated;

create or replace function public.unmark_daily_cash_collected(p_club_id uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.current_user_club_role(p_club_id) is distinct from 'owner' then
    raise exception 'Only a club owner can undo a collection.' using errcode = '42501';
  end if;
  delete from public.daily_cash_collections where club_id = p_club_id and date = p_date;
end;
$$;
revoke all on function public.unmark_daily_cash_collected(uuid, date) from public, anon;
grant execute on function public.unmark_daily_cash_collected(uuid, date) to authenticated;
