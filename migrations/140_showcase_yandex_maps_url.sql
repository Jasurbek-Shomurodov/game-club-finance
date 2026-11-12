-- A club page can link its own Yandex Maps place.
--
-- The public "Open in Yandex Maps" link searched "<club>, <address>", and Yandex
-- guessed: the Algoritm branch opened the building at Zargarlik 30A with an
-- "Исправить неточность" prompt, a transliterated name gave "Исправлена
-- опечатка" and a list of other clubs, some marked "Возможно, не работает".
-- With yandex_maps_url set, the link opens the club's own card instead; the
-- address search stays as the fallback. Re-runnable.

alter table public.club_showcases add column if not exists yandex_maps_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_showcases_yandex_maps_url') then
    alter table public.club_showcases add constraint club_showcases_yandex_maps_url
      check (yandex_maps_url is null or yandex_maps_url ~ '^https://(www\.)?yandex\.(uz|ru|com|kz|by)/maps/');
  end if;
end;
$$;

-- Replaces 117's payload; only yandex_maps_url is new.
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
    'yandex_maps_url', showcase.yandex_maps_url,
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

-- Both Pixel Gaming branches' own Yandex Maps cards.
update public.club_showcases set yandex_maps_url = 'https://yandex.uz/maps/org/pixel_gaming/226249440799/'
  where slug = 'pixel-game-club' and yandex_maps_url is null;
update public.club_showcases set yandex_maps_url = 'https://yandex.uz/maps/org/pixel_gaming/76261965061/'
  where slug = 'main-game-club' and yandex_maps_url is null;
