-- Add GTA VI to the game library of both Pixel Gaming clubs, right after GTA V.
--
-- The cover is a 600x900 portrait crop of Rockstar's official GTA VI key art,
-- stored in the public showcase bucket under each club's folder. The insert is
-- skipped for a club that already lists GTA VI. Data only; no schema change.

insert into showcase_games (club_id, title, genre, image_url, sort_order)
select club.id,
       'GTA VI',
       'Action',
       'https://vmhpsizkzbtsjblrieie.supabase.co/storage/v1/object/public/showcase/'
         || club.id || '/gta6.jpg',
       85
from clubs club
where club.id in ('7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305', '8390a015-5f28-4f78-a5a2-302dd61852a7')
  and not exists (
    select 1
    from showcase_games game
    where game.club_id = club.id
      and game.title = 'GTA VI'
  );
