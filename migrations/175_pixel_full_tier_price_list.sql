-- Every tier on the "Pixel Gaming" (Matbuotchilar 17) public price list shows
-- VIP, Pro and Standard side by side. The one-hour row had only Pro, so VIP
-- (30 000 UZS, half its 2+1 price like the other tiers) and Standard (15 000,
-- the Standard zone's hourly rate) are added. VIP 3+2 (90 000) and 7 hours
-- (150 000), switched off in 131, are shown again.
-- Rows are matched by club and Russian title, so the inserts run once and a
-- database without that club is left as it is.

update public.showcase_offers
set is_active = true
where club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and title in ('VIP · 3+2 часа', 'VIP · 7 часов')
  and not is_active;

insert into public.showcase_offers
  (club_id, title, description, translations, badge, price, time_window, sort_order, is_active)
select
  '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'::uuid,
  offer.title_ru,
  offer.description_ru,
  jsonb_build_object(
    'title', jsonb_build_object('ru', offer.title_ru, 'uz', offer.title_uz, 'en', offer.title_en),
    'description', jsonb_build_object('ru', offer.description_ru, 'uz', offer.description_uz, 'en', offer.description_en)
  ),
  offer.badge,
  offer.price,
  null,
  offer.sort_order,
  true
from (values
  ('VIP · 1 час', 'VIP · 1 soat', 'VIP · 1 hour',
   'Час игры в VIP зоне.', 'VIP zonada 1 soat o‘yin.', 'One hour of play in the VIP zone.',
   'VIP', 30000, 9),
  ('Стандарт · 1 час', 'Standart · 1 soat', 'Standard · 1 hour',
   'Час игры в зоне Стандарт.', 'Standart zonada 1 soat o‘yin.', 'One hour of play in the Standard zone.',
   'STD', 15000, 19)
) as offer (title_ru, title_uz, title_en, description_ru, description_uz, description_en, badge, price, sort_order)
where exists (select 1 from public.clubs where id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305')
  and not exists (
    select 1 from public.showcase_offers existing
    where existing.club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305' and existing.title = offer.title_ru
  );
