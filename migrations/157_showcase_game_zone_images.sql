-- Public page zone images and Pixel Gaming (Matbuotchilar 17) PC specs.
--
-- Every PC zone of both Pixel Gaming clubs shows a Counter-Strike 2 image, and
-- every PlayStation zone a GTA IV image. The images are square crops of the
-- Steam store art, stored in the public showcase bucket under each club's folder.
-- The Matbuotchilar Standard zone now has RTX 5060 PCs with 27" 280 Hz monitors.
-- Data only; no schema change.

update showcase_pc_zones z
set image_url = 'https://vmhpsizkzbtsjblrieie.supabase.co/storage/v1/object/public/showcase/'
  || z.club_id || case when coalesce(z.kind, 'pc') = 'playstation' then '/gta4-square.jpg' else '/cs2-square.jpg' end
where z.club_id in ('7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305', '8390a015-5f28-4f78-a5a2-302dd61852a7');

update showcase_pc_zones
set cpu = 'Intel Core i5-12400F',
    gpu = 'NVIDIA RTX 5060',
    ram = '16 GB',
    monitor_size_inches = 27,
    monitor_refresh_hz = 280
where id = '2a92b37a-3991-49b2-81db-7c37ef95af81'
  and club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305';
