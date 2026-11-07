-- Public price list for the "Pixel Gaming (Algoritm)" club page: hourly rates
-- for the Standard and VIP zones by day and night, day and night packages, and
-- 3-hour bundles. Stored as showcase_offers (102) with ru/uz/en translations;
-- `title` is the Russian fallback, like the other club's offers. Re-runnable:
-- an offer is inserted only when the club exists and has no offer with that
-- title yet, so owner edits made later are kept. A blank badge or time window
-- is stored as null (the form already saves them that way), like the title.

alter table public.showcase_offers
  drop constraint if exists showcase_offers_badge_not_blank,
  add constraint showcase_offers_badge_not_blank check (badge is null or btrim(badge) <> '');

alter table public.showcase_offers
  drop constraint if exists showcase_offers_time_window_not_blank,
  add constraint showcase_offers_time_window_not_blank check (time_window is null or btrim(time_window) <> '');

insert into public.showcase_offers
  (club_id, title, description, translations, badge, price, time_window, sort_order, is_active)
select
  '8390a015-5f28-4f78-a5a2-302dd61852a7'::uuid,
  offer.title_ru,
  offer.description_ru,
  jsonb_build_object(
    'title', jsonb_build_object('ru', offer.title_ru, 'uz', offer.title_uz, 'en', offer.title_en),
    'description', jsonb_build_object('ru', offer.description_ru, 'uz', offer.description_uz, 'en', offer.description_en)
  ),
  offer.badge,
  offer.price,
  offer.time_window,
  offer.sort_order,
  true
from (values
  ('Стандарт · 1 час (день)', 'Standart · 1 soat (kunduzgi)', 'Standard · 1 hour (day)',
   'Час игры в стандартной зоне днём.', 'Standart zonada kunduzi 1 soat o‘yin.', 'One hour of play in the Standard zone during the day.',
   '1H', 10000, '06:00 – 18:00', 10),
  ('Стандарт · 1 час (ночь)', 'Standart · 1 soat (kechki)', 'Standard · 1 hour (night)',
   'Час игры в стандартной зоне вечером и ночью.', 'Standart zonada kechqurun va tunda 1 soat o‘yin.', 'One hour of play in the Standard zone in the evening and at night.',
   '1H', 15000, '18:00 – 06:00', 20),
  ('VIP зона · 1 час (день)', 'VIP zona · 1 soat (kunduzgi)', 'VIP zone · 1 hour (day)',
   'Час игры в VIP зоне днём.', 'VIP zonada kunduzi 1 soat o‘yin.', 'One hour of play in the VIP zone during the day.',
   'VIP', 13000, '06:00 – 18:00', 30),
  ('VIP зона · 1 час (ночь)', 'VIP zona · 1 soat (kechki)', 'VIP zone · 1 hour (night)',
   'Час игры в VIP зоне вечером и ночью.', 'VIP zonada kechqurun va tunda 1 soat o‘yin.', 'One hour of play in the VIP zone in the evening and at night.',
   'VIP', 18000, '18:00 – 06:00', 40),
  ('Дневной пакет', 'Kunduzgi paket', 'Day package',
   'Играй весь день с 06:00 до 18:00 по фиксированной цене.', '06:00 dan 18:00 gacha kun bo‘yi qat’iy narxda o‘yna.', 'Play all day from 06:00 to 18:00 at a fixed price.',
   'DAY', 40000, '06:00 – 18:00', 50),
  ('Дневной пакет VIP', 'Kunduzgi paket VIP', 'Day package VIP',
   'Весь день с 06:00 до 18:00 в VIP зоне по фиксированной цене.', '06:00 dan 18:00 gacha VIP zonada qat’iy narxda o‘yna.', 'All day from 06:00 to 18:00 in the VIP zone at a fixed price.',
   'DAY VIP', 65000, '06:00 – 18:00', 60),
  ('Ночной пакет', 'Kechki paket', 'Night package',
   'Играй всю ночь с 23:00 до 06:00 по фиксированной цене.', '23:00 dan 06:00 gacha tun bo‘yi qat’iy narxda o‘yna.', 'Play all night from 23:00 to 06:00 at a fixed price.',
   'NIGHT', 50000, '23:00 – 06:00', 70),
  ('Ночной пакет VIP', 'Kechki paket VIP', 'Night package VIP',
   'Вся ночь с 23:00 до 06:00 в VIP зоне по фиксированной цене.', '23:00 dan 06:00 gacha VIP zonada qat’iy narxda o‘yna.', 'All night from 23:00 to 06:00 in the VIP zone at a fixed price.',
   'NIGHT VIP', 75000, '23:00 – 06:00', 80),
  ('3 часа · день', '3 soat · kunduzgi', '3 hours · day',
   '3 часа игры в стандартной зоне днём по тарифу.', 'Standart zonada kunduzi 3 soatlik tarif.', 'A 3-hour daytime bundle in the Standard zone.',
   '3H', 25000, '06:00 – 18:00', 90),
  ('3 часа · ночь', '3 soat · kechki', '3 hours · night',
   '3 часа игры в стандартной зоне вечером и ночью по тарифу.', 'Standart zonada kechki 3 soatlik tarif.', 'A 3-hour evening bundle in the Standard zone.',
   '3H', 40000, '18:00 – 06:00', 100),
  ('3 часа · день VIP', '3 soat · kunduzgi VIP', '3 hours · day VIP',
   '3 часа игры в VIP зоне днём по тарифу.', 'VIP zonada kunduzi 3 soatlik tarif.', 'A 3-hour daytime bundle in the VIP zone.',
   '3H VIP', 30000, '06:00 – 18:00', 110),
  ('3 часа · ночь VIP', '3 soat · kechki VIP', '3 hours · night VIP',
   '3 часа игры в VIP зоне вечером и ночью по тарифу.', 'VIP zonada kechki 3 soatlik tarif.', 'A 3-hour evening bundle in the VIP zone.',
   '3H VIP', 45000, '18:00 – 06:00', 120)
) as offer (title_ru, title_uz, title_en, description_ru, description_uz, description_en, badge, price, time_window, sort_order)
where exists (select 1 from public.clubs where id = '8390a015-5f28-4f78-a5a2-302dd61852a7')
  and not exists (
    select 1 from public.showcase_offers existing
    where existing.club_id = '8390a015-5f28-4f78-a5a2-302dd61852a7' and existing.title = offer.title_ru
  );
