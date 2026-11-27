# Real PC counts: 95 at Algoritm (Zargarlik 30A), 55 at Square (Matbuotchilar 17)

Owner's numbers (2026-11-27): 95 PCs at `main-game-club` (club 8390a015-5f28-4f78-a5a2-302dd61852a7), 55 at
`pixel-game-club` (club 7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305). The public site derives its counter from
`showcase_pc_zones.pc_count` (kind = 'pc') and states a number in `club_showcases.tagline` and
`translations.tagline.{en,ru,uz}`.

Current production data:
- main-game-club: Стандарт 82 + VIP 15 = 97; tagline says "82 игровых ПК … VIP-зона на 15 мест".
- pixel-game-club: Стандарт 33 + VIP 10 = 43; tagline says 43. Pro packages are sold but there is no Pro zone row.

## Slice 1 (one migration, data only)

`migrations/NNN_pixel_real_pc_counts.sql` (next number) + regenerated manifest. Re-runnable, scoped by club_id and
zone id, and guarded so it only touches rows that still hold the old values:

- main-game-club: Стандарт (zone 59c4c98a-658e-4243-ab0f-ac7ae4627a03) 82 → 80; VIP stays 15 → total 95.
  Tagline and its three translations: "82" → "95" (the VIP "15" part stays).
- pixel-game-club: Стандарт (zone 2a92b37a-3991-49b2-81db-7c37ef95af81, kind 'pc') 33 → 35; VIP stays 10; add a
  PC zone "Pro" with pc_count 10, price_per_hour 20000, sort_order 25 (between VIP 20 and PlayStation 30),
  translations like the other zones, no specs invented (null) → total 55. The Pro insert runs once, only while no
  Pro pc zone exists, Стандарт is 33 or 35 and VIP is 10, so statement order and re-runs do not matter.
  Tagline translations: "43" → "55" in en/ru/uz, and the top-level tagline if it carries the number.
- Replace only the number inside the existing text (regexp/replace on the exact old phrase), never rewrite the
  whole sentence; a row whose text no longer contains the old number is left alone.
- Check every other place that states a PC count for these clubs (brand rows in `showcase_brands`, FAQ/search
  taglines from migrations 174/178, `src/messages/*.json`, seo helpers, e2e fixtures and tests) and fix or report.
- A migration test in the style of the existing `src/lib/supabase/*Migration.test.ts` files.

This is an UPDATE of existing rows, asked for by the owner in these words: "we have 95 PCs in algoritm branch fix
everywhere. 55 in square branch". The split was confirmed by the owner on 2026-11-27: Algoritm Стандарт 80 + VIP 15; Square Стандарт 35 + VIP 10 +
Pro 10. Built as `migrations/187_pixel_real_pc_counts.sql` with `src/lib/supabase/pixelRealPcCountsMigration.test.ts`.
