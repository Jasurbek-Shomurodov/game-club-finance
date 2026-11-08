-- New zone names on the "Pixel Gaming" (Matbuotchilar 17) public page: the
-- private booths ("Кабинка") are now VIP and the main hall ("Общий зал") is
-- now Standard. Adds a Pro tier between them: 20 000 UZS an hour and a 2+1
-- package (3 hours) for 45 000 UZS. Prices of existing offers are unchanged.
-- Rows are matched by club and their current Russian title/name, so a database
-- without them (or one already renamed) is left as it is, and the Pro offers
-- are inserted only once. The Pro zone card (PC count, hardware) is left for
-- the owner to add in the showcase editor, since it lists real equipment.
-- A zone's per-language names, when present, must be an object like
-- {"ru": "...", "uz": "...", "en": "..."} (what the editor already saves).

alter table public.showcase_pc_zones
  drop constraint if exists showcase_pc_zones_name_translations_object,
  add constraint showcase_pc_zones_name_translations_object
    check (translations -> 'name' is null or jsonb_typeof(translations -> 'name') = 'object');

update public.showcase_pc_zones
set name = 'VIP',
    translations = jsonb_build_object('name', jsonb_build_object('ru', 'VIP', 'uz', 'VIP', 'en', 'VIP'))
where club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and translations #>> '{name,en}' = 'Private booth';

update public.showcase_pc_zones
set name = 'Стандарт',
    translations = jsonb_build_object('name', jsonb_build_object('ru', 'Стандарт', 'uz', 'Standart', 'en', 'Standard'))
where club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and kind = 'pc'
  and name = 'Общий зал';

update public.showcase_offers offers
set title = renamed.title_ru,
    translations = jsonb_build_object(
      'title', jsonb_build_object('ru', renamed.title_ru, 'uz', renamed.title_uz, 'en', renamed.title_en),
      'description', jsonb_build_object('ru', renamed.description_ru, 'uz', renamed.description_uz, 'en', renamed.description_en)
    ),
    description = renamed.description_ru
from (values
  ('Кабинка · 2+1 часа', 'VIP · 2+1 часа', 'VIP · 2+1 soat', 'VIP · 2+1 hours',
   'Плати за 2 часа в VIP — играй 3.', 'VIP zonada 2 soat uchun to‘la — 3 soat o‘yna.', 'Pay for 2 hours in VIP, play 3.'),
  ('Общий зал · 2+1 часа', 'Стандарт · 2+1 часа', 'Standart · 2+1 soat', 'Standard · 2+1 hours',
   'Плати за 2 часа — играй 3.', '2 soat uchun to‘la — 3 soat o‘yna.', 'Pay for 2 hours, play 3.'),
  ('Общий зал · 3+2 часа', 'Стандарт · 3+2 часа', 'Standart · 3+2 soat', 'Standard · 3+2 hours',
   'Плати за 3 часа — играй 5.', '3 soat uchun to‘la — 5 soat o‘yna.', 'Pay for 3 hours, play 5.'),
  ('Общий зал · 7 часов', 'Стандарт · 7 часов', 'Standart · 7 soat', 'Standard · 7 hours',
   'Целых 7 часов игры по выгодной цене.', '7 soat o‘yin foydali narxda.', 'A full 7 hours of play at a better price.')
) as renamed (old_title, title_ru, title_uz, title_en, description_ru, description_uz, description_en)
where offers.club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and offers.title = renamed.old_title;

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
  ('Pro · 1 час', 'Pro · 1 soat', 'Pro · 1 hour',
   'Час игры в Pro зоне.', 'Pro zonada 1 soat o‘yin.', 'One hour of play in the Pro zone.',
   'PRO', 20000, 12),
  ('Pro · 2+1 часа', 'Pro · 2+1 soat', 'Pro · 2+1 hours',
   '3 часа в Pro зоне за 45 000 сум вместо 60 000.', 'Pro zonada 3 soat 60 000 o‘rniga 45 000 so‘m.', '3 hours in the Pro zone for 45,000 UZS instead of 60,000.',
   '2+1', 45000, 15)
) as offer (title_ru, title_uz, title_en, description_ru, description_uz, description_en, badge, price, sort_order)
where exists (select 1 from public.clubs where id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305')
  and not exists (
    select 1 from public.showcase_offers existing
    where existing.club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305' and existing.title = offer.title_ru
  );
