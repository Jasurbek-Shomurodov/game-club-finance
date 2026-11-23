-- Pixel Gaming (Matbuotchilar 17) opened a VIP zone: two private rooms of five
-- computers. The club admin entered it by hand in one language, with the room
-- layout inside the zone name ("VIP 2 Кабинке по 5 компьютеров"). The public
-- price table matches a zone to its "VIP · …" prices by name, so the long
-- name gave VIP a second row. This tidies that entry:
--   * the zone is named "VIP" in every language, and the room layout moves to
--     the zone description, per language (translations.description; the
--     `peripherals` column stays the single-language fallback);
--   * brand names get their usual spelling;
--   * the zone sorts after Standard, as at the other branch;
--   * the club page says it has a VIP zone and counts the ten new computers.
-- The other branch's VIP zone also gets its name in Uzbek and English.
-- Every statement matches only the admin's original text, so a re-run, or a
-- run after someone has edited the page again, changes nothing.

update public.showcase_pc_zones zones
set name = 'VIP',
    translations = jsonb_build_object(
      'name', jsonb_build_object('ru', 'VIP', 'uz', 'VIP', 'en', 'VIP'),
      'description', jsonb_build_object(
        'ru', '2 кабинки по 5 компьютеров — удобно играть своей командой.',
        'uz', '5 ta kompyuterli 2 ta kabina — jamoa bo‘lib o‘ynashga qulay.',
        'en', '2 private rooms with 5 PCs each — made for playing as a team.')),
    peripherals = '2 кабинки по 5 компьютеров — удобно играть своей командой.',
    gpu = 'ZOTAC Gaming RTX 5060',
    mouse = 'Rapoo VT7',
    headset = 'Rapoo VH800',
    sort_order = 20
from public.club_showcases showcase
where showcase.club_id = zones.club_id
  and showcase.slug = 'pixel-game-club'
  and zones.name = 'VIP 2 Кабинке по 5 компьютеров';

update public.showcase_pc_zones zones
set translations = zones.translations || jsonb_build_object('name', jsonb_build_object('ru', 'VIP', 'uz', 'VIP', 'en', 'VIP'))
from public.club_showcases showcase
where showcase.club_id = zones.club_id
  and showcase.slug = 'main-game-club'
  and zones.name = 'VIP'
  and zones.translations -> 'name' = jsonb_build_object('ru', 'VIP');

-- The page's own words, only where they still read as 174 left them.
update public.club_showcases
set amenities = amenities || array['vip_zone'],
    tagline = replace(tagline, '33 мощных игровых ПК, PlayStation 5', '43 мощных игровых ПК, VIP-кабинки, PlayStation 5'),
    translations = translations || jsonb_build_object('tagline', jsonb_build_object(
      'ru', replace(translations -> 'tagline' ->> 'ru', '33 мощных игровых ПК, PlayStation 5', '43 мощных игровых ПК, VIP-кабинки, PlayStation 5'),
      'uz', replace(translations -> 'tagline' ->> 'uz', '33 ta kuchli o‘yin kompyuteri, PlayStation 5', '43 ta kuchli o‘yin kompyuteri, VIP kabinalar, PlayStation 5'),
      'en', replace(translations -> 'tagline' ->> 'en', '33 powerful gaming PCs, PlayStation 5', '43 powerful gaming PCs, private VIP rooms, PlayStation 5')))
where slug = 'pixel-game-club'
  and not ('vip_zone' = any(amenities))
  and translations -> 'tagline' ->> 'en' like '%33 powerful gaming PCs, PlayStation 5%'
  and exists (
    select 1 from public.showcase_pc_zones zones
    where zones.club_id = club_showcases.club_id and zones.kind = 'pc' and zones.name = 'VIP'
  );
