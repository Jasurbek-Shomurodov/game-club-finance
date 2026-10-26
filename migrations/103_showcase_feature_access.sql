-- "showcase" becomes a page an owner can grant on Team, like every other
-- page. Role defaults (NULL feature_access) do not include it, so nothing
-- changes until an owner grants it explicitly; owners keep full access
-- through current_user_can_access_club_feature. The club page, games,
-- computer zones and offers (098-102) and their image folder move from
-- owner-only to that feature. The brand page (099) stays the owner's own row.
-- Re-runnable.

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
      'showcase',
      'team',
      'settings'
    ]::text[]
  );

drop policy if exists "club_owner_all_club_showcases" on public.club_showcases;
drop policy if exists "club_showcase_editors_all_club_showcases" on public.club_showcases;
create policy "club_showcase_editors_all_club_showcases" on public.club_showcases
  for all to authenticated
  using (public.current_user_can_access_club_feature(club_id, 'showcase'))
  with check (public.current_user_can_access_club_feature(club_id, 'showcase'));

drop policy if exists "club_owner_all_showcase_games" on public.showcase_games;
drop policy if exists "club_showcase_editors_all_showcase_games" on public.showcase_games;
create policy "club_showcase_editors_all_showcase_games" on public.showcase_games
  for all to authenticated
  using (public.current_user_can_access_club_feature(club_id, 'showcase'))
  with check (public.current_user_can_access_club_feature(club_id, 'showcase'));

drop policy if exists "club_owner_all_showcase_pc_zones" on public.showcase_pc_zones;
drop policy if exists "club_showcase_editors_all_showcase_pc_zones" on public.showcase_pc_zones;
create policy "club_showcase_editors_all_showcase_pc_zones" on public.showcase_pc_zones
  for all to authenticated
  using (public.current_user_can_access_club_feature(club_id, 'showcase'))
  with check (public.current_user_can_access_club_feature(club_id, 'showcase'));

drop policy if exists "club_owner_all_showcase_offers" on public.showcase_offers;
drop policy if exists "club_showcase_editors_all_showcase_offers" on public.showcase_offers;
create policy "club_showcase_editors_all_showcase_offers" on public.showcase_offers
  for all to authenticated
  using (public.current_user_can_access_club_feature(club_id, 'showcase'))
  with check (public.current_user_can_access_club_feature(club_id, 'showcase'));

-- Image uploads follow the same access. Skipped where the storage schema does
-- not exist (local PostgreSQL test databases).
do $storage$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;

  execute 'drop policy if exists "showcase_owner_insert" on storage.objects';
  execute 'drop policy if exists "showcase_editor_insert" on storage.objects';
  execute $policy$
    create policy "showcase_editor_insert" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'showcase'
        and (storage.foldername(name))[1] in (
          select memberships.club_id::text from public.club_memberships memberships
          where memberships.user_id = auth.uid()
            and public.current_user_can_access_club_feature(memberships.club_id, 'showcase')
        )
      )
  $policy$;

  execute 'drop policy if exists "showcase_owner_update" on storage.objects';
  execute 'drop policy if exists "showcase_editor_update" on storage.objects';
  execute $policy$
    create policy "showcase_editor_update" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'showcase'
        and (storage.foldername(name))[1] in (
          select memberships.club_id::text from public.club_memberships memberships
          where memberships.user_id = auth.uid()
            and public.current_user_can_access_club_feature(memberships.club_id, 'showcase')
        )
      )
  $policy$;

  execute 'drop policy if exists "showcase_owner_delete" on storage.objects';
  execute 'drop policy if exists "showcase_editor_delete" on storage.objects';
  execute $policy$
    create policy "showcase_editor_delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'showcase'
        and (storage.foldername(name))[1] in (
          select memberships.club_id::text from public.club_memberships memberships
          where memberships.user_id = auth.uid()
            and public.current_user_can_access_club_feature(memberships.club_id, 'showcase')
        )
      )
  $policy$;
end;
$storage$;
