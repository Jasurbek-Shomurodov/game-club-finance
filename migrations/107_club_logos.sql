-- A logo per club, set by its owner in Settings. It replaces the generic
-- gamepad badge in the club picker and Settings, and shows on the public club
-- cards. Only http(s) links are stored; uploads go to the public showcase
-- bucket under the club's folder (098, 103). Re-runnable.

alter table public.clubs
  add column if not exists logo_url text;

alter table public.clubs
  drop constraint if exists clubs_logo_url_http,
  add constraint clubs_logo_url_http
    check (logo_url is null or logo_url ~* '^https?://');

comment on column public.clubs.logo_url is 'Club logo image (http/https); null shows the default badge.';

-- Replaces 048's bootstrap with the club logo added.
create or replace function public.get_dashboard_bootstrap()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  return jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'full_name', profile.full_name,
        'role', profile.role
      )
      from public.profiles profile
      where profile.id = v_user_id
    ),
    'memberships', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'club_id', membership.club_id,
          'user_id', membership.user_id,
          'role', membership.role,
          'feature_access', membership.feature_access,
          'created_at', membership.created_at,
          'updated_at', membership.updated_at,
          'clubs', case when club.id is null then null else jsonb_build_object(
            'id', club.id,
            'name', club.name,
            'address', club.address,
            'logo_url', club.logo_url,
            'business_day_start_hour', club.business_day_start_hour,
            'enabled_payment_methods', club.enabled_payment_methods,
            'is_active', club.is_active,
            'created_at', club.created_at,
            'updated_at', club.updated_at
          ) end
        ) order by membership.created_at
      )
      from public.club_memberships membership
      left join public.clubs club on club.id = membership.club_id
      where membership.user_id = v_user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_dashboard_bootstrap() from public, anon;
grant execute on function public.get_dashboard_bootstrap() to authenticated;

-- Replaces 106's payload with the club logo added.
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
