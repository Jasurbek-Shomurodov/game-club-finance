-- Search-friendly club descriptions. The tagline is the page's meta
-- description in Google and Yandex, so each club's now names what people
-- search for (компьютерный клуб, the district, PS5, 24/7) in every language.
-- The Algoritm club's Russian text was the Uzbek Cyrillic Telegram post; it is
-- replaced with Russian. `tagline` is the Russian fallback column, as the
-- admin form saves it. Re-runnable: a club is updated only while its Russian
-- tagline is still the old text, so later owner edits are kept.

update public.club_showcases
set
  tagline = 'Компьютерный клуб Pixel Gaming (Algoritm) в Чиланзаре: 82 игровых ПК, VIP-зона на 15 мест и PlayStation 5. CS2, Dota 2 и все популярные игры, напитки и снеки. Работаем 24/7.',
  translations = jsonb_set(
    coalesce(translations, '{}'::jsonb),
    '{tagline}',
    jsonb_build_object(
      'ru', 'Компьютерный клуб Pixel Gaming (Algoritm) в Чиланзаре: 82 игровых ПК, VIP-зона на 15 мест и PlayStation 5. CS2, Dota 2 и все популярные игры, напитки и снеки. Работаем 24/7.',
      'uz', 'Chilonzordagi Pixel Gaming (Algoritm) kompyuter klubi: 82 ta o‘yin kompyuteri, 15 o‘rinli VIP zona va PlayStation 5. CS2, Dota 2 va barcha mashhur o‘yinlar, ichimlik va sneklar. 24/7 ishlaymiz.',
      'en', 'Pixel Gaming (Algoritm) gaming club in Chilanzar, Tashkent: 82 gaming PCs, a 15-seat VIP zone and PlayStation 5. CS2, Dota 2 and every popular title, drinks and snacks. Open 24/7.'
    )
  )
where club_id = '8390a015-5f28-4f78-a5a2-302dd61852a7'::uuid
  and coalesce(translations #>> '{tagline,ru}', tagline, '') like '%PIXEL GAME CLUB%';

update public.club_showcases
set
  tagline = 'Компьютерный клуб Pixel Gaming у площади Амира Темура (Матбуотчилар, 17): 33 мощных игровых ПК, PlayStation 5, быстрые мониторы и все популярные игры. Работаем 24/7.',
  translations = jsonb_set(
    coalesce(translations, '{}'::jsonb),
    '{tagline}',
    jsonb_build_object(
      'ru', 'Компьютерный клуб Pixel Gaming у площади Амира Темура (Матбуотчилар, 17): 33 мощных игровых ПК, PlayStation 5, быстрые мониторы и все популярные игры. Работаем 24/7.',
      'uz', 'Amir Temur xiyoboni yonidagi Pixel Gaming kompyuter klubi (Matbuotchilar, 17): 33 ta kuchli o‘yin kompyuteri, PlayStation 5, tezkor monitorlar va barcha mashhur o‘yinlar. 24/7 ishlaymiz.',
      'en', 'Pixel Gaming club by Amir Temur Square (Matbuotchilar 17), Tashkent: 33 powerful gaming PCs, PlayStation 5, fast monitors and every popular title. Open 24/7.'
    )
  )
where club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'::uuid
  and coalesce(translations #>> '{tagline,ru}', tagline, '') = 'Клуб Pixel Gaming: мощные игровые ПК, быстрые мониторы, удобная периферия и любимые игры. Заходи поиграть с друзьями.';
