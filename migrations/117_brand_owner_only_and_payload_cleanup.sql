-- Brand pages (099) were writable by any signed-in account, including an
-- unapproved sign-up: nothing in the database asked the writer to own a club,
-- so a stranger could publish a page on the public domain. Inserts and updates
-- now need a club owner; everyone keeps reading and deleting their own row.
-- Brands whose owner no longer owns a club are unpublished, not deleted.
--
-- Also drops `storage` from the anonymous zone payload: PC zones stopped
-- showing it, and the column stays for old rows. Re-runnable.

drop policy if exists "own_showcase_brand" on public.showcase_brands;
drop policy if exists "showcase_brand_read_own" on public.showcase_brands;
drop policy if exists "showcase_brand_delete_own" on public.showcase_brands;
drop policy if exists "showcase_brand_insert_club_owner" on public.showcase_brands;
drop policy if exists "showcase_brand_update_club_owner" on public.showcase_brands;

create policy "showcase_brand_read_own" on public.showcase_brands
  for select to authenticated
  using (owner_id = auth.uid());

create policy "showcase_brand_delete_own" on public.showcase_brands
  for delete to authenticated
  using (owner_id = auth.uid());

create policy "showcase_brand_insert_club_owner" on public.showcase_brands
  for insert to authenticated
  with check (owner_id = auth.uid() and public.current_user_owns_any_club());

create policy "showcase_brand_update_club_owner" on public.showcase_brands
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.current_user_owns_any_club());

update public.showcase_brands brand
set is_published = false
where brand.is_published
  and not exists (
    select 1
    from public.club_memberships memberships
    where memberships.user_id = brand.owner_id
      and memberships.role = 'owner'
  );

-- Replaces 107's payload; only zones.storage is gone.
create or replace function public.public_showcase_payload(p_club_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'club_name', clubs.name,
    'logo_url', clubs.logo_url,
    'slug', showcase.slug,
    'headline', showcase.headline,
    'tagline', showcase.tagline,
    'translations', showcase.translations,
    'hero_image_url', showcase.hero_image_url,
    'address', coalesce(showcase.address, clubs.address),
    'phone', showcase.phone,
    'email', showcase.email,
    'opening_hours', showcase.opening_hours,
    'telegram_url', showcase.telegram_url,
    'instagram_url', showcase.instagram_url,
    'youtube_url', showcase.youtube_url,
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', games.id, 'title', games.title, 'genre', games.genre, 'image_url', games.image_url
      ) order by games.sort_order, games.created_at)
      from public.showcase_games games
      where games.club_id = showcase.club_id
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', zones.id, 'kind', zones.kind, 'name', zones.name, 'translations', zones.translations,
        'pc_count', zones.pc_count,
        'console', zones.console, 'controllers', zones.controllers,
        'cpu', zones.cpu, 'gpu', zones.gpu, 'ram', zones.ram,
        'monitor', zones.monitor, 'monitor_size_inches', zones.monitor_size_inches,
        'monitor_refresh_hz', zones.monitor_refresh_hz,
        'mouse', zones.mouse, 'keyboard', zones.keyboard, 'headset', zones.headset, 'chair', zones.chair,
        'peripherals', zones.peripherals, 'price_per_hour', zones.price_per_hour,
        'image_url', zones.image_url
      ) order by zones.sort_order, zones.created_at)
      from public.showcase_pc_zones zones
      where zones.club_id = showcase.club_id
    ), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', offers.id, 'title', offers.title, 'description', offers.description,
        'translations', offers.translations, 'badge', offers.badge, 'price', offers.price,
        'time_window', offers.time_window
      ) order by offers.sort_order, offers.created_at)
      from public.showcase_offers offers
      where offers.club_id = showcase.club_id and offers.is_active
    ), '[]'::jsonb)
  )
  from public.club_showcases showcase
  join public.clubs clubs on clubs.id = showcase.club_id
  where showcase.club_id = p_club_id
    and showcase.is_published
    and clubs.is_active;
$$;

revoke all on function public.public_showcase_payload(uuid) from public, anon, authenticated;
