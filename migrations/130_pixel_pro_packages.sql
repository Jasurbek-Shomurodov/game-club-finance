-- Pro tier packages on the "Pixel Gaming" (Matbuotchilar 17) public page, from
-- the new price board: 2+1 hours is now 40 000 UZS (was 45 000 in 129), and
-- 3+2 hours (60 000) and 7 hours (100 000) are added. Rows are matched by club
-- and Russian title, so the update touches only 129's offer and the inserts
-- run once; databases without that club are left as they are.
-- The public page reads a club's active offers in display order, so index
-- exactly that.

create index if not exists idx_showcase_offers_club_active_order
  on public.showcase_offers (club_id, sort_order, created_at)
  where is_active;

update public.showcase_offers
set price = 40000,
    description = 'Плати за 2 часа в Pro — играй 3.',
    translations = jsonb_set(
      translations,
      '{description}',
      jsonb_build_object(
        'ru', 'Плати за 2 часа в Pro — играй 3.',
        'uz', 'Pro zonada 2 soat uchun to‘la — 3 soat o‘yna.',
        'en', 'Pay for 2 hours in Pro, play 3.'
      )
    )
where club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and title = 'Pro · 2+1 часа'
  and price = 45000;

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
  ('Pro · 3+2 часа', 'Pro · 3+2 soat', 'Pro · 3+2 hours',
   'Плати за 3 часа в Pro — играй 5.', 'Pro zonada 3 soat uchun to‘la — 5 soat o‘yna.', 'Pay for 3 hours in Pro, play 5.',
   '3+2', 60000, 17),
  ('Pro · 7 часов', 'Pro · 7 soat', 'Pro · 7 hours',
   'Целых 7 часов в Pro зоне по выгодной цене.', 'Pro zonada 7 soat o‘yin foydali narxda.', 'A full 7 hours in the Pro zone at a better price.',
   '7H', 100000, 18)
) as offer (title_ru, title_uz, title_en, description_ru, description_uz, description_en, badge, price, sort_order)
where exists (select 1 from public.clubs where id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305')
  and not exists (
    select 1 from public.showcase_offers existing
    where existing.club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305' and existing.title = offer.title_ru
  );
