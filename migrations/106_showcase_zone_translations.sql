-- Zone names per language, like page headlines (101) and offers (102):
-- "Общий зал" / "Umumiy zal" / "Main hall". `translations` holds
-- {"name": {"ru": "...", "uz": "...", "en": "..."}}; `name` stays the
-- single-language fallback, so existing zones keep showing.

alter table public.showcase_pc_zones
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.showcase_pc_zones
  drop constraint if exists showcase_pc_zones_translations_object,
  add constraint showcase_pc_zones_translations_object check (jsonb_typeof(translations) = 'object');

-- Replaces 104's payload; adds each zone's translations. get_public_brand (105)
-- and get_public_showcase read it unchanged.
create or replace function public.public_showcase_payload(p_club_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'club_name', clubs.name,
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
        'cpu', zones.cpu, 'gpu', zones.gpu, 'ram', zones.ram, 'storage', zones.storage,
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
