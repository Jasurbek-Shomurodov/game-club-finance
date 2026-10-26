-- Packages and offers on public club pages: "2+1", night packages, hourly
-- bundles. Unrelated to the bar `promotions` table (078), which tracks free
-- products given away under a spend rule. Title and description are kept per
-- language in `translations` like 101; `title`/`description` are the
-- single-language fallback. Only active offers are published.

create table if not exists public.showcase_offers (
  id uuid primary key default uuid_generate_v4(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null,
  description text,
  translations jsonb not null default '{}'::jsonb,
  badge text,
  price numeric,
  time_window text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint showcase_offers_title_not_blank check (btrim(title) <> ''),
  constraint showcase_offers_price_non_negative check (price is null or price >= 0),
  constraint showcase_offers_translations_object check (jsonb_typeof(translations) = 'object')
);

create index if not exists idx_showcase_offers_club_order
  on public.showcase_offers (club_id, sort_order, created_at);

alter table public.showcase_offers enable row level security;

drop policy if exists "club_owner_all_showcase_offers" on public.showcase_offers;
create policy "club_owner_all_showcase_offers" on public.showcase_offers
  for all to authenticated
  using (public.current_user_club_role(club_id) = 'owner')
  with check (public.current_user_club_role(club_id) = 'owner');

revoke all on public.showcase_offers from anon;
grant select, insert, update, delete on public.showcase_offers to authenticated;

-- Replaces 101's payload; adds the club's active offers.
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
