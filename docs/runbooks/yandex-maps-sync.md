# Yandex Maps sync

Keeps every club's Yandex Maps card (Yandex Business, `yandex.uz/sprav`) in
step with the app: the full price list, replies to new reviews, and an "AI bot"
image in each club's Telegram group. Plan: `docs/plans/yandex-maps-sync.md`.

Yandex Business has **no public API** for price lists or reviews (checked Nov
2026). Everything that can live in the repo does (`src/lib/yandexMaps/`,
`scripts/yandex-maps-sync.ts`); the Yandex steps are done by an agent in the
owner's signed-in Google Chrome (Claude in Chrome), never the built-in browser
pane. Nothing here types a password: if Chrome is not signed in to Yandex, stop
and ask the owner to sign in.

## Which clubs

A club takes part when its public page has a Yandex Maps place link,
`club_showcases.yandex_maps_url` = `https://yandex.uz/maps/org/<slug>/<orgId>/`
(set through a migration, like `140_showcase_yandex_maps_url.sql`). The
`<orgId>` is the Yandex Business organisation id. Today:

| Club (showcase slug) | Address | Yandex org id |
|---|---|---|
| `pixel-game-club` | Матбуотчилар 17 | `226249440799` |
| `main-game-club` | Заргарлик 30А | `76261965061` |

A new branch needs nothing else once its link is set.

## Files

Everything is written to `artifacts/yandex/` (git-ignored; never commit it).

| File | Written by | Holds |
|---|---|---|
| `<orgId>.yml` | `plan` | The full price list to upload |
| `current-<orgId>.json` | agent (optional) | The card's current list, for the diff |
| `plan-<orgId>.json` | `plan`, then agent | Items, skipped zones/offers, the diff and its counts, `uploaded` |
| `reviews-<orgId>.json` | agent | Unanswered reviews read from the card |
| `replies-<orgId>.json` | `replies`, then agent | One reply per review and whether it is posted |
| `yandex-reviews-<orgId>-<date>.png` | `report` | The Telegram image |
| `sent-<orgId>-<date>.json` | `report --confirm-send` | The Telegram message id; the club is not sent again that business date |

## Commands

The script reads `.env.local` (Supabase service role, AI model keys, Telegram
bot and `TELEGRAM_*_CLUB_ID`/`TELEGRAM_*_CHAT_ID`) and prints no secret. It
reads the production database (read-only) and writes only the files above and,
with `report --confirm-send`, Telegram messages.

```bash
npm run yandex:sync -- plan                    # YML per club + diff against current-<orgId>.json
npm run yandex:sync -- replies                 # replies-<orgId>.json from reviews-<orgId>.json
npm run yandex:sync -- report --dry-run        # PNGs and captions only
npm run yandex:sync -- report --confirm-send   # PNGs sent to each club's Telegram group, once per business date
npm run yandex:sync -- report --confirm-send --resend  # send again although sent-<orgId>-<date>.json exists
npm run yandex:sync -- plan --club <club uuid> # any command, one club only
```

`report` refuses to run without `--dry-run` or `--confirm-send`. It also
refuses to send a club whose `plan-` or `replies-<orgId>.json` was not made
(`generatedAt`) on the club's current business date: run `plan` and `replies`
again first. After a successful send it writes `sent-<orgId>-<date>.json` and
skips that club for the rest of the business date unless `--resend` is given.

## Run order

1. **Read the current price list (optional, for the diff).** In Chrome open
   `https://yandex.uz/sprav/companies`, pick the club, then the sidebar link
   **Товары и услуги** (`/sprav/<orgId>/p/edit/price-lists/`). Navigate by
   clicking sidebar links: a direct load of a deep link sometimes bounces back
   to `/sprav/companies`. Read the list with `get_page_text` and save it as
   `artifacts/yandex/current-<orgId>.json`:

   ```json
   [{ "name": "Игровой час — VIP", "price": "25 000 сум", "description": "…" }]
   ```

   `price` may be a number or the text the page shows. Leave `description`
   out when the page does not show it; descriptions are then not compared.
2. **`npm run yandex:sync -- plan`.** It prints, per club, the item count,
   zones or offers skipped for having no price, and the change against the
   saved list (`+` added, `−` removed, `~` changed). Items:
   - "Игровой час — <zone>" (category "Игровое время") for each zone with an
     hourly price, unless an active offer of that zone is already a 1-hour
     package (then that offer is the hour price and the zone is listed as
     skipped);
   - each active offer with a price (category "Пакеты и акции"), named by
     its Russian title with the app's " · " written as " — " and its time
     window in brackets: "Стандарт — 1 час (06:00–18:00)". The description is
     the offer's text only. Names are unique: if two still match, the price is
     added ("… — 10 000 сум"), then a number;
   - pictures are the zone photo, else the club logo.
3. **Show the owner the diff and get a yes before uploading** (first live
   run at least, and whenever something is removed).
4. **Upload the YML.** Товары и услуги → **Загрузить XLS/YML** → tab **YML** →
   **Загрузить YML** (file up to 15 MB) → choose `artifacts/yandex/<orgId>.yml`
   → **Загрузить прайс-лист**. Yandex's dialog says a new upload fully erases
   and replaces the previous list: that is how items the app no longer has
   disappear. Wait for the list to show the new items, and check a price or
   two against the plan output. Then set `"uploaded": true` in
   `artifacts/yandex/plan-<orgId>.json`: only then does the report caption
   mention the price-list change.
5. **Read unanswered reviews.** Sidebar → **Отзывы**
   (`/sprav/<orgId>/p/edit/reviews/`). Each review shows author, date, text,
   then **Ответ компании** and a date when it is already answered;
   unanswered ones show quick-reply chips and an empty reply box. Read the
   page with `get_page_text` (scroll to load older reviews when needed) and
   save `artifacts/yandex/reviews-<orgId>.json`:

   ```json
   {
     "rating": 4.9,
     "reviewCount": 128,
     "reviews": [
       { "author": "Азиз", "date": "12 ноября 2026", "rating": 5, "text": "Отличный клуб" }
     ]
   }
   ```

   Only unanswered reviews are needed; one marked `"answered": true` is
   ignored. `rating`/`reviewCount` are the card's (shown in the dashboard
   header or on the public card) and may be left out. A review may carry
   `"reply"` to use the owner's own words instead of a written one, and
   `"key"` to name it; without a key it is "author|date|first 40 characters".
6. **`npm run yandex:sync -- replies`.** Writes a reply to each review with
   the same prompt and model chain as the Google replies
   (`createReviewReplyWriter`), oldest first, and prints each review with its
   reply. A reply already in `replies-<orgId>.json` (or in the review's
   `reply`) is kept, so edits survive a rerun. To change a reply, edit it in
   `replies-<orgId>.json`.
7. **Show the owner every reply and get a yes before posting** (first live
   run at least). Replies are public.
8. **Post each reply** in the review's reply box on the Отзывы page and send
   it. After each one is visible under the review as **Ответ компании**, set
   `"posted": true` on that entry in `replies-<orgId>.json`. Only posted
   replies count as sent in the report; a reply left unposted shows as
   "Ошибка ответа".
9. **`npm run yandex:sync -- report --dry-run`**, look at the PNGs, then
   **`report --confirm-send`**. Each club with a Telegram group
   (`targetChatId`) gets one image: the Google "AI bot" layout titled
   "Яндекс Карты", with the card's rating, review count, replies sent and
   each review with its reply, captioned
   `🤖 ИИ-бот <club> (<address>): отзывы Яндекс Карт за DD.MM.YYYY. Ответов отправлено: N. Прайс-лист: +A / −R / ~C.`
   (the price part only when the plan is marked `"uploaded": true` and had a
   saved current list to diff against). The date is the club's business
   date. A second `--confirm-send` the same business date skips clubs already
   sent (see `sent-<orgId>-<date>.json`) unless `--resend`.

A review is never answered twice: Yandex itself shows which reviews already
have a reply, and only unanswered ones are read in step 5.

## When it breaks

- **Yandex changed its dashboard.** The repo logic does not depend on the
  page; update the Chrome steps above and keep the JSON shapes.
- **Upload rejected.** Offer ids are Latin letters and digits, at most 20
  characters (`z`/`o` + 19 hex digits of the row id), currency `UZS`, prices
  whole sums; the file follows Yandex's own template
  (`https://yandex.uz/sprav/templates/price-list-template.xml`). Report the
  dialog's error text before changing the format.
- **Photos lost after an upload.** The upload replaces photos too; every item
  is sent with the zone photo or club logo, so fix the zone's `image_url` or
  the club logo in the app and upload again.
- **`replies` writes nothing.** No AI model key in `.env.local`: write the
  replies by hand in `replies-<orgId>.json` (or as `reply` in the reviews
  file) and rerun.
- **`report` not sent.** `TELEGRAM_BOT_TOKEN` missing, or the club has no
  `TELEGRAM_*_CLUB_ID` → `TELEGRAM_*_CHAT_ID` pair in `.env.local`.
