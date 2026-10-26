-- Contact details for the public page footer: the brand page (099) gains a
-- phone, email, opening hours and YouTube link; club pages (098) gain an
-- email and YouTube link. All optional.
--
-- PlayStation zones: a showcase zone is now a 'pc' or 'playstation' kind.
-- A PlayStation zone uses pc_count for its number of consoles, `console` for
-- the model, `controllers` per console, the monitor columns for its TV, and
-- headset/chair for its gear. Existing zones stay 'pc'. Both public reads
-- return the new fields.

alter table public.showcase_brands
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists opening_hours text,
  add column if not exists youtube_url text;

alter table public.club_showcases
  add column if not exists email text,
  add column if not exists youtube_url text;

alter table public.showcase_pc_zones
  add column if not exists kind text not null default 'pc',
  add column if not exists console text,
  add column if not exists controllers integer;

alter table public.showcase_pc_zones
  drop constraint if exists showcase_pc_zones_kind_valid,
  add constraint showcase_pc_zones_kind_valid check (kind in ('pc', 'playstation')),
  drop constraint if exists showcase_pc_zones_controllers_range,
  add constraint showcase_pc_zones_controllers_range check (controllers is null or (controllers >= 1 and controllers <= 20));

alter table public.showcase_brands
  drop constraint if exists showcase_brands_email_format,
  add constraint showcase_brands_email_format check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

alter table public.club_showcases
  drop constraint if exists club_showcases_email_format,
  add constraint club_showcases_email_format check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- Replaces 102's payload; adds the club's email and YouTube link and each
-- zone's kind, console and controllers.
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
        'id', zones.id, 'kind', zones.kind, 'name', zones.name, 'pc_count', zones.pc_count,
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

-- Replaces 101's brand read; adds the brand's contact details.
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
    'phone', brand.phone,
    'email', brand.email,
    'opening_hours', brand.opening_hours,
    'telegram_url', brand.telegram_url,
    'instagram_url', brand.instagram_url,
    'youtube_url', brand.youtube_url,
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
