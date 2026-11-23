-- More for a visitor of a public club page: photos, what the club offers, a
-- short branch name and a landmark, the Google Maps place, and the Google
-- rating the daily review digest (160) already records.
--
-- club_showcases gains:
--   amenities        keys from a fixed list (the site translates and draws them)
--   gallery          up to 12 photo links, in display order
--   google_maps_url  the club's own Google Maps place; the address search stays
--                    as the fallback, as with yandex_maps_url (140)
-- `translations` gains three optional fields, per language like headline (101):
--   branch    a short name that tells the branches apart ("Chilanzar")
--   landmark  what the club is next to
--   address   the address in the visitor's language
-- Re-runnable.

alter table public.club_showcases
  add column if not exists amenities text[] not null default '{}',
  add column if not exists gallery text[] not null default '{}',
  add column if not exists google_maps_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_showcases_amenities_known') then
    alter table public.club_showcases add constraint club_showcases_amenities_known
      check (amenities <@ array[
        'open_24_7', 'playstation', 'vip_zone', 'night_packages', 'food', 'drinks',
        'card_payment', 'wifi', 'air_conditioning', 'parking', 'tournaments', 'smoking_area'
      ]::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'club_showcases_gallery_size') then
    alter table public.club_showcases add constraint club_showcases_gallery_size
      check (cardinality(gallery) <= 12);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'club_showcases_google_maps_url') then
    alter table public.club_showcases add constraint club_showcases_google_maps_url
      check (google_maps_url is null
        or google_maps_url ~ '^https://(maps\.app\.goo\.gl/|goo\.gl/maps/|g\.page/|(maps\.|www\.)?google\.(com|[a-z]{2}|com?\.[a-z]{2})/)');
  end if;
end;
$$;

-- Replaces 140's payload. New: amenities, gallery, google_maps_url and the
-- latest recorded Google rating. The function is security definer, so it may
-- read google_review_digests, which browser roles cannot; only the rating and
-- the review count leave it.
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
    'google_maps_url', showcase.google_maps_url,
    'amenities', to_jsonb(showcase.amenities),
    'gallery', to_jsonb(showcase.gallery),
    'google_rating', rating.average_rating,
    'google_review_count', rating.total_review_count,
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
  left join lateral (
    select digests.average_rating, digests.total_review_count
    from public.google_review_digests digests
    where digests.club_id = showcase.club_id
      and digests.average_rating is not null
      and digests.total_review_count > 0
    order by digests.digest_date desc
    limit 1
  ) rating on true
  where showcase.club_id = p_club_id
    and showcase.is_published
    and clubs.is_active;
$$;

revoke all on function public.public_showcase_payload(uuid) from public, anon, authenticated;

-- Both Pixel Gaming branches: a name that tells them apart, a landmark, the
-- address in each language, and what the clubs are known to offer (round the
-- clock, PlayStation, a bar, a card terminal; ZarKebab food at Matbuotchilar;
-- a VIP zone and night packages at Zargarlik). Only where nothing is set yet.
update public.club_showcases
set translations = translations || jsonb_build_object(
      'branch', jsonb_build_object('ru', 'Амир Темур', 'uz', 'Amir Temur', 'en', 'Amir Temur'),
      'landmark', jsonb_build_object(
        'ru', 'За ТЦ «Зарафшон», рядом со сквером Амира Темура',
        'uz', '«Zarafshon» savdo markazi orqasida, Amir Temur xiyoboni yonida',
        'en', 'Behind Zarafshon shopping centre, by Amir Temur Square'),
      'address', jsonb_build_object(
        'ru', 'Ташкент, ул. Матбуотчилар, 17',
        'uz', 'Toshkent, Matbuotchilar ko‘chasi, 17',
        'en', '17 Matbuotchilar St, Tashkent')),
    amenities = array['open_24_7', 'playstation', 'food', 'drinks', 'card_payment']
where slug = 'pixel-game-club' and not (translations ? 'branch') and amenities = '{}';

update public.club_showcases
set translations = translations || jsonb_build_object(
      'branch', jsonb_build_object('ru', 'Чиланзар', 'uz', 'Chilonzor', 'en', 'Chilanzar'),
      'landmark', jsonb_build_object(
        'ru', 'Район «Алгоритм»',
        'uz', '«Algoritm» hududi',
        'en', 'Algoritm area'),
      'address', jsonb_build_object(
        'ru', 'Ташкент, Чиланзарский район, ул. Заргарлик, 30А',
        'uz', 'Toshkent, Chilonzor tumani, Zargarlik ko‘chasi, 30A',
        'en', '30A Zargarlik St, Chilanzar district, Tashkent')),
    amenities = array['open_24_7', 'playstation', 'vip_zone', 'night_packages', 'drinks', 'card_payment']
where slug = 'main-game-club' and not (translations ? 'branch') and amenities = '{}';
