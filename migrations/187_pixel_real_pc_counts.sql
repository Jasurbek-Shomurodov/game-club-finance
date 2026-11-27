-- The owner's real PC counts on the public club pages
-- (docs/plans/pc-counts-95-55.md, slice 1): 95 computers at "Pixel Gaming
-- (Algoritm)" (Zargarlik 30A) and 55 at "Pixel Gaming" (Matbuotchilar 17).
-- The page's PC counter is the sum of its 'pc' zones, and each club's tagline
-- (the meta description, 174) states the number in words.
--
-- Algoritm (8390a015): Standard 82 -> 80, VIP stays 15, so 97 -> 95. The
--   tagline's "82 gaming PCs" becomes "95 gaming PCs" in the Russian fallback
--   column and in ru/uz/en; the "15-seat VIP zone" part stays.
-- Matbuotchilar 17 (7a9c8427): Standard 33 -> 35, VIP stays 10. Pro
--   packages are sold (129) but the page has no Pro zone, so a Pro zone of 10
--   computers at 20 000 UZS an hour is added between VIP (20) and PlayStation
--   (30); its hardware and photo are left for the owner to fill in the
--   showcase editor, as 129 intended. 43 -> 55, and the tagline's "43"
--   becomes "55".
--
-- DESTRUCTIVE: updates existing rows in place: two showcase_pc_zones rows
-- (pc_count) and both clubs' club_showcases rows (tagline and
-- translations.tagline). Only the number inside the old phrase is replaced;
-- the rest of each text is kept as it is.
--
-- Every statement matches its rows by club (and zone id) and the old values
-- only: a second run, a run after the owner has edited the page, and a
-- database without these clubs (local, tests) change nothing. Re-runnable.

-- Algoritm: Standard 82 -> 80.
update public.showcase_pc_zones
set pc_count = 80
where id = '59c4c98a-658e-4243-ab0f-ac7ae4627a03'
  and club_id = '8390a015-5f28-4f78-a5a2-302dd61852a7'
  and kind = 'pc'
  and pc_count = 82;

-- Matbuotchilar 17: Standard 33 -> 35.
update public.showcase_pc_zones
set pc_count = 35
where id = '2a92b37a-3991-49b2-81db-7c37ef95af81'
  and club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and kind = 'pc'
  and pc_count = 33;

-- Matbuotchilar 17: the Pro zone, once, and only while the club's other PC
-- zones are as this migration was written against: Standard 33 (before the
-- update above) or 35 (after it), and VIP 10.
insert into public.showcase_pc_zones (club_id, kind, name, translations, pc_count, price_per_hour, sort_order)
select
  clubs.id,
  'pc',
  'Pro',
  jsonb_build_object('name', jsonb_build_object('ru', 'Pro', 'uz', 'Pro', 'en', 'Pro')),
  10,
  20000,
  25
from public.clubs clubs
where clubs.id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and not exists (
    select 1 from public.showcase_pc_zones zones
    where zones.club_id = clubs.id
      and zones.kind = 'pc'
      and (lower(btrim(zones.name)) = 'pro' or lower(btrim(zones.translations #>> '{name,en}')) = 'pro')
  )
  and exists (
    select 1 from public.showcase_pc_zones zones
    where zones.id = '2a92b37a-3991-49b2-81db-7c37ef95af81'
      and zones.club_id = clubs.id
      and zones.kind = 'pc'
      and zones.pc_count in (33, 35)
  )
  and exists (
    select 1 from public.showcase_pc_zones zones
    where zones.club_id = clubs.id
      and zones.kind = 'pc'
      and zones.name = 'VIP'
      and zones.pc_count = 10
  );

-- The taglines: the Russian fallback column, then each language that still
-- holds the old phrase. A language without a tagline is not added.
update public.club_showcases
set tagline = replace(tagline, '82 игровых ПК, VIP-зона на 15 мест', '95 игровых ПК, VIP-зона на 15 мест')
where club_id = '8390a015-5f28-4f78-a5a2-302dd61852a7'
  and tagline like '%82 игровых ПК, VIP-зона на 15 мест%';

update public.club_showcases
set translations = translations || jsonb_build_object('tagline', (translations -> 'tagline') || jsonb_strip_nulls(jsonb_build_object(
      'ru', replace(translations #>> '{tagline,ru}', '82 игровых ПК, VIP-зона на 15 мест', '95 игровых ПК, VIP-зона на 15 мест'),
      'uz', replace(translations #>> '{tagline,uz}', '82 ta o‘yin kompyuteri, 15 o‘rinli VIP zona', '95 ta o‘yin kompyuteri, 15 o‘rinli VIP zona'),
      'en', replace(translations #>> '{tagline,en}', '82 gaming PCs, a 15-seat VIP zone', '95 gaming PCs, a 15-seat VIP zone'))))
where club_id = '8390a015-5f28-4f78-a5a2-302dd61852a7'
  and jsonb_typeof(translations -> 'tagline') = 'object'
  and (translations #>> '{tagline,ru}' like '%82 игровых ПК, VIP-зона на 15 мест%'
    or translations #>> '{tagline,uz}' like '%82 ta o‘yin kompyuteri, 15 o‘rinli VIP zona%'
    or translations #>> '{tagline,en}' like '%82 gaming PCs, a 15-seat VIP zone%');

update public.club_showcases
set tagline = replace(tagline, '43 мощных игровых ПК', '55 мощных игровых ПК')
where club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and tagline like '%43 мощных игровых ПК%';

update public.club_showcases
set translations = translations || jsonb_build_object('tagline', (translations -> 'tagline') || jsonb_strip_nulls(jsonb_build_object(
      'ru', replace(translations #>> '{tagline,ru}', '43 мощных игровых ПК', '55 мощных игровых ПК'),
      'uz', replace(translations #>> '{tagline,uz}', '43 ta kuchli o‘yin kompyuteri', '55 ta kuchli o‘yin kompyuteri'),
      'en', replace(translations #>> '{tagline,en}', '43 powerful gaming PCs', '55 powerful gaming PCs'))))
where club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and jsonb_typeof(translations -> 'tagline') = 'object'
  and (translations #>> '{tagline,ru}' like '%43 мощных игровых ПК%'
    or translations #>> '{tagline,uz}' like '%43 ta kuchli o‘yin kompyuteri%'
    or translations #>> '{tagline,en}' like '%43 powerful gaming PCs%');
