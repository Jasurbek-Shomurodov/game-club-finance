-- "Pixel Gaming" (Matbuotchilar 17): PlayStation 5 is 40 000 UZS an hour on
-- the printed price board, not 50 000. Matched by club, kind and the old
-- price, so a database without that zone (or already updated) is unchanged.

update public.showcase_pc_zones
set price_per_hour = 40000
where club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and kind = 'playstation'
  and price_per_hour = 50000;
