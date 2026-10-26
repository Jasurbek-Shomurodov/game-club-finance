-- Structured PC specs for showcase zones (098): monitor size in inches and
-- refresh rate in Hz as numbers, and separate mouse, keyboard, headset,
-- chair and storage fields. `monitor` keeps the monitor model and
-- `peripherals` stays as free-text notes, so existing rows keep showing.

alter table public.showcase_pc_zones
  add column if not exists monitor_size_inches numeric,
  add column if not exists monitor_refresh_hz integer,
  add column if not exists mouse text,
  add column if not exists keyboard text,
  add column if not exists headset text,
  add column if not exists chair text,
  add column if not exists storage text;

alter table public.showcase_pc_zones
  drop constraint if exists showcase_pc_zones_monitor_size_range,
  add constraint showcase_pc_zones_monitor_size_range
    check (monitor_size_inches is null or (monitor_size_inches >= 10 and monitor_size_inches <= 100)),
  drop constraint if exists showcase_pc_zones_monitor_refresh_range,
  add constraint showcase_pc_zones_monitor_refresh_range
    check (monitor_refresh_hz is null or (monitor_refresh_hz >= 30 and monitor_refresh_hz <= 1000));

comment on column public.showcase_pc_zones.monitor is 'Monitor model; size and refresh rate have their own columns since 100.';
comment on column public.showcase_pc_zones.peripherals is 'Other equipment and notes.';

-- Replaces 099's payload with the new zone fields; get_public_showcase and
-- get_public_brand both read it.
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
