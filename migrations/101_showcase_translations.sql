-- Headline and description in every supported language (ru, uz, en) for club
-- pages (098) and brand pages (099). `translations` holds
-- {"headline": {"ru": "...", "uz": "...", "en": "..."}, "tagline": {...}}.
-- The single-language headline/tagline columns stay as the fallback, so pages
-- saved before this migration keep showing their text.

alter table public.club_showcases
  add column if not exists translations jsonb not null default '{}'::jsonb;
alter table public.showcase_brands
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.club_showcases
  drop constraint if exists club_showcases_translations_object,
  add constraint club_showcases_translations_object check (jsonb_typeof(translations) = 'object');
alter table public.showcase_brands
  drop constraint if exists showcase_brands_translations_object,
  add constraint showcase_brands_translations_object check (jsonb_typeof(translations) = 'object');

-- Replaces 100's payload; adds the club's translations.
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
    'opening_hours', showcase.opening_hours,
    'telegram_url', showcase.telegram_url,
    'instagram_url', showcase.instagram_url,
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', games.id, 'title', games.title, 'genre', games.genre, 'image_url', games.image_url
      ) order by games.sort_order, games.created_at)
      from public.showcase_games games
      where games.club_id = showcase.club_id
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', zones.id, 'name', zones.name, 'pc_count', zones.pc_count,
        'cpu', zones.cpu, 'gpu', zones.gpu, 'ram', zones.ram, 'storage', zones.storage,
        'monitor', zones.monitor, 'monitor_size_inches', zones.monitor_size_inches,
        'monitor_refresh_hz', zones.monitor_refresh_hz,
        'mouse', zones.mouse, 'keyboard', zones.keyboard, 'headset', zones.headset, 'chair', zones.chair,
        'peripherals', zones.peripherals, 'price_per_hour', zones.price_per_hour,
        'image_url', zones.image_url
      ) order by zones.sort_order, zones.created_at)
      from public.showcase_pc_zones zones
      where zones.club_id = showcase.club_id
    ), '[]'::jsonb)
  )
  from public.club_showcases showcase
  join public.clubs clubs on clubs.id = showcase.club_id
  where showcase.club_id = p_club_id
    and showcase.is_published
    and clubs.is_active;
$$;

revoke all on function public.public_showcase_payload(uuid) from public, anon, authenticated;

-- Replaces 099's brand read; adds the brand's translations.
create or replace function public.get_public_brand(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'slug', brand.slug,
    'name', brand.name,
    'tagline', brand.tagline,
    'translations', brand.translations,
    'hero_image_url', brand.hero_image_url,
    'telegram_url', brand.telegram_url,
    'instagram_url', brand.instagram_url,
    'clubs', coalesce((
      select jsonb_agg(public.public_showcase_payload(clubs.id) order by clubs.created_at, clubs.id)
      from public.clubs clubs
      join public.club_showcases showcase on showcase.club_id = clubs.id and showcase.is_published
      join public.club_memberships memberships
        on memberships.club_id = clubs.id
       and memberships.user_id = brand.owner_id
       and memberships.role = 'owner'
      where clubs.is_active
    ), '[]'::jsonb)
  )
  from public.showcase_brands brand
  where brand.slug = lower(btrim(p_slug))
    and brand.is_published;
$$;

revoke all on function public.get_public_brand(text) from public;
grant execute on function public.get_public_brand(text) to anon, authenticated;
