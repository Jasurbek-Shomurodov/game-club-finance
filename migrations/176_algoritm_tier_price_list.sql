-- Public price lists matched to the clubs' printed price boards.
--
-- "Pixel Gaming (Algoritm)": offers are renamed to the "Zone · package" shape
-- the other club uses, so the page compares Standard and VIP side by side in
-- one card per package (1 hour, 3 hours, day and night packages). Day and
-- night stay apart through each offer's time window, which the page shows.
-- Packages of one kind share a badge and a zone-free description. Prices are
-- unchanged; they already match the board.
--
-- "Pixel Gaming" (Matbuotchilar 17): the board lists VIP with 1 hour and 2+1
-- only, so VIP 3+2 and 7 hours, shown again in 175, are switched off again.
--
-- Rows are matched by club and their current Russian title, so a database
-- without them (or one already renamed) is left as it is.

update public.showcase_offers
set is_active = false
where club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and title in ('VIP · 3+2 часа', 'VIP · 7 часов')
  and is_active;

update public.showcase_offers offers
set title = renamed.title_ru,
    badge = renamed.badge,
    sort_order = renamed.sort_order,
    description = coalesce(renamed.description_ru, offers.description),
    translations = jsonb_build_object(
      'title', jsonb_build_object('ru', renamed.title_ru, 'uz', renamed.title_uz, 'en', renamed.title_en),
      'description', coalesce(
        case when renamed.description_ru is null then null
          else jsonb_build_object('ru', renamed.description_ru, 'uz', renamed.description_uz, 'en', renamed.description_en) end,
        offers.translations -> 'description'
      )
    )
from (values
  ('Стандарт · 1 час (день)', 'Стандарт · 1 час', 'Standart · 1 soat', 'Standard · 1 hour', '1H', 10, null, null, null),
  ('Стандарт · 1 час (ночь)', 'Стандарт · 1 час', 'Standart · 1 soat', 'Standard · 1 hour', '1H', 20, null, null, null),
  ('VIP зона · 1 час (день)', 'VIP · 1 час', 'VIP · 1 soat', 'VIP · 1 hour', 'VIP', 30, null, null, null),
  ('VIP зона · 1 час (ночь)', 'VIP · 1 час', 'VIP · 1 soat', 'VIP · 1 hour', 'VIP', 40, null, null, null),
  ('3 часа · день', 'Стандарт · 3 часа', 'Standart · 3 soat', 'Standard · 3 hours', '3H', 42,
   'Три часа игры по выгодному тарифу.', '3 soat o‘yin foydali tarifda.', 'Three hours of play at a better rate.'),
  ('3 часа · ночь', 'Стандарт · 3 часа', 'Standart · 3 soat', 'Standard · 3 hours', '3H', 43,
   'Три часа игры по выгодному тарифу.', '3 soat o‘yin foydali tarifda.', 'Three hours of play at a better rate.'),
  ('3 часа · день VIP', 'VIP · 3 часа', 'VIP · 3 soat', 'VIP · 3 hours', '3H', 44,
   'Три часа игры по выгодному тарифу.', '3 soat o‘yin foydali tarifda.', 'Three hours of play at a better rate.'),
  ('3 часа · ночь VIP', 'VIP · 3 часа', 'VIP · 3 soat', 'VIP · 3 hours', '3H', 45,
   'Три часа игры по выгодному тарифу.', '3 soat o‘yin foydali tarifda.', 'Three hours of play at a better rate.'),
  ('Дневной пакет', 'Стандарт · Дневной пакет', 'Standart · Kunduzgi paket', 'Standard · Day package', 'DAY', 50,
   'Играй весь день с 06:00 до 18:00 по фиксированной цене.', '06:00 dan 18:00 gacha kun bo‘yi qat’iy narxda o‘yna.', 'Play all day from 06:00 to 18:00 at a fixed price.'),
  ('Дневной пакет VIP', 'VIP · Дневной пакет', 'VIP · Kunduzgi paket', 'VIP · Day package', 'DAY', 60,
   'Играй весь день с 06:00 до 18:00 по фиксированной цене.', '06:00 dan 18:00 gacha kun bo‘yi qat’iy narxda o‘yna.', 'Play all day from 06:00 to 18:00 at a fixed price.'),
  ('Ночной пакет', 'Стандарт · Ночной пакет', 'Standart · Kechki paket', 'Standard · Night package', 'NIGHT', 70,
   'Играй всю ночь с 23:00 до 06:00 по фиксированной цене.', '23:00 dan 06:00 gacha tun bo‘yi qat’iy narxda o‘yna.', 'Play all night from 23:00 to 06:00 at a fixed price.'),
  ('Ночной пакет VIP', 'VIP · Ночной пакет', 'VIP · Kechki paket', 'VIP · Night package', 'NIGHT', 80,
   'Играй всю ночь с 23:00 до 06:00 по фиксированной цене.', '23:00 dan 06:00 gacha tun bo‘yi qat’iy narxda o‘yna.', 'Play all night from 23:00 to 06:00 at a fixed price.')
) as renamed (old_title, title_ru, title_uz, title_en, badge, sort_order, description_ru, description_uz, description_en)
where offers.club_id = '8390a015-5f28-4f78-a5a2-302dd61852a7'
  and offers.title = renamed.old_title;
