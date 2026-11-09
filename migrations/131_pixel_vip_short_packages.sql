-- VIP on the "Pixel Gaming" (Matbuotchilar 17) public page goes back to just
-- 1 hour and 2+1: the 3+2 (90 000) and 7 hour (150 000) packages added in 130
-- are hidden. They are switched off rather than deleted so that 130, which
-- inserts by title only when missing, cannot bring them back, and the owner
-- can turn them on again from the showcase editor.
-- An offer's description, when present, must not be blank (the editor already
-- saves an empty description as null).

alter table public.showcase_offers
  drop constraint if exists showcase_offers_description_not_blank,
  add constraint showcase_offers_description_not_blank
    check (description is null or btrim(description) <> '');

update public.showcase_offers
set is_active = false
where club_id = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305'
  and title in ('VIP · 3+2 часа', 'VIP · 7 часов')
  and is_active;
