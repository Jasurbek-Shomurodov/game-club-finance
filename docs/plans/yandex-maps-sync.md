# Yandex Maps sync

## Goal and user flow

One command keeps every club's Yandex Maps card (Yandex Business, `yandex.uz/sprav`)
in step with the app, answers new Yandex reviews, and posts a summary image to
each club's Telegram group.

1. `npm run yandex:sync -- plan` reads every club that has a Yandex Maps place
   (`club_showcases.yandex_maps_url`), builds the card's full price list from the
   app (zones' hourly prices + active packages/offers) and writes one YML file
   per club, plus a human-readable diff against the card's current list when a
   snapshot of it is given.
2. The Yandex side has **no public API** for price lists or reviews (checked
   Nov 2026: Yandex Business only offers manual edits, an XLS/YML upload that
   fully replaces the list, and a dashboard reply box). So the Yandex steps are
   done in the owner's signed-in Chrome by the agent, following the runbook
   `docs/runbooks/yandex-maps-sync.md`:
   - upload `artifacts/yandex/<orgId>.yml` in "Товары и услуги → Загрузить
     XLS/YML → YML". The upload replaces the whole list, which is what removes
     items the app no longer has;
   - read unanswered reviews with the page snippet in the runbook and save them
     to `artifacts/yandex/reviews-<orgId>.json`;
   - post each reply in the review's reply box.
3. `npm run yandex:sync -- replies` writes a reply for every unanswered review
   with the existing review-reply model chain (`createReviewReplyWriter`), or
   keeps a reply already present in the JSON (so the agent can write or edit
   them). Output: `artifacts/yandex/replies-<orgId>.json`.
4. `npm run yandex:sync -- report` renders one PNG per club (the Google "AI bot"
   digest layout, titled for Yandex Maps) from the run results and sends it to
   the club's Telegram group (`targetChatId(clubId)`). `--dry-run` writes the
   PNGs only.

## Placement

Repo tooling only: `scripts/yandex-maps-sync.ts`, pure logic in
`src/lib/yandexMaps/`. No admin page in this slice. Branches: a club takes part
as soon as its showcase has a Yandex Maps URL (set through a migration, like
migration 140). New branches need nothing else.

## Architecture

- `src/lib/yandexMaps/orgId.ts`: `yandexOrgId(url)` → `"226249440799"` from a
  `…/maps/org/<slug>/<id>/` URL (reuse `normalizeYandexMapsUrl`).
- `src/lib/yandexMaps/priceList.ts` (pure):
  - `buildYandexPriceItems(club)` → items `{ id, name, price, category,
    description, picture }`:
    - one "Игровой час — <zone>" per zone with `price_per_hour`;
    - one item per active offer (`is_active`), name = Russian translation of the
      title when present (`translations.ru.title`), else `title`; description =
      ru description, else description, plus `time_window` when set; price
      required (offers without a price are skipped and reported);
    - category: "Игровое время" for hourly, "Пакеты и акции" for offers;
    - picture: the matching zone's `image_url` (offer title prefix matched with
      the existing `splitOfferTitle` logic), else the club `logo_url`, else none.
    - stable ids: `zone-<uuid>` / `offer-<uuid>`.
  - `buildYandexYml(items, { clubName })` → YML string in the format of Yandex's
    template (`/sprav/templates/price-list-template.xml`): `yml_catalog > shop >
    categories, offers > offer[id] > name, price, currencyId=UZS, categoryId,
    picture?, description?`. XML-escaped.
  - `diffPriceList(current, next)` → `{ added, removed, changed }` by
    normalized name (case/space/dash-insensitive); `current` is the snapshot
    `[{ name, price, description }]` the agent scrapes.
- `src/lib/yandexMaps/reviews.ts` (pure): `YandexReview { key, author, date,
  rating, text }`, `parseYandexReviews(json)`, `toGoogleShape(review)` so the
  existing `reviewReplyPrompt`/`cleanReply` are reused unchanged.
- `src/lib/yandexMaps/digest.ts`: builds a `ReviewDigest` per club from the run
  results (`{ rating, reviewCount, results: ReviewReplyResult[] }`) and a
  caption `🤖 ИИ-бот <club> (<address>): отзывы Яндекс Карт за DD.MM.YYYY.
  Ответов отправлено: N. Прайс-лист: +A / −R / ~C.`. Make the digest image's
  source label a parameter of `renderReviewDigestPng` (default "Google Maps")
  instead of copying the renderer.
- `scripts/yandex-maps-sync.ts`: loads `.env.local` like
  `generate-daily-finance-preview.ts`, service client, subcommands above,
  `--club <id>` to limit. Reads: `club_showcases` (club_id, yandex_maps_url,
  address), `clubs` (name, logo_url), `showcase_pc_zones`, `showcase_offers`,
  every query filtered by `club_id`. Writes only files under
  `artifacts/yandex/` (git-ignored) and Telegram messages in `report`.
  `report` refuses to run without `--confirm-send` unless `--dry-run`.

## Data model

No migration. No new tables in this slice (Yandex itself shows which reviews
already have a reply, so a review is never answered twice).

## Design rules

Telegram copy in Russian, emoji first, amounts with space separators. No
in-app UI, so no locale or skeleton changes.

## Tests

- `priceList.test.ts`: items from zones/offers, ru translation wins, inactive
  and price-less offers skipped, picture fallback, XML escaping, YML shape,
  diff (added/removed/changed, name normalisation).
- `orgId.test.ts`, `reviews.test.ts`, `digest.test.ts` (caption text, counts).
- `reviewDigestImage`: existing tests still pass with the default label; one
  test for the Yandex label.

## Slices

1. Everything above (pure libs + tests + script + runbook + npm script +
   `artifacts/` in `.gitignore` if not already).

## Risks

- Yandex's dashboard can change; the runbook keeps the Chrome steps short and
  the logic in the repo.
- A YML upload replaces photos on existing items; pictures are sent from the
  app so the list keeps images.
- Replies go out publicly: the first live run shows the owner the price-list
  diff and every reply before anything is uploaded or posted.
