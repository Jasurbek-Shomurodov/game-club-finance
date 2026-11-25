# Telegram daily finance report runbook

Read this before changing or operating the scheduled Telegram report.

## Pipeline and ownership

Each configured target is built independently from that club's Supabase rows:

```text
Supabase data -> calculations -> SVG -> PNG -> Telegram sendPhoto
  -> delivery status saved
```

Supabase Cron owns the production schedule. It runs daily at `03:00 UTC`, which
is `08:00 Asia/Tashkent`, and invokes the production endpoint without a date.
Each target then reports its own club's most recently closed business day: the
day before `serverTodayIso(now, clubs.business_day_start_hour)`. A club whose
business day starts after 08:00 is still in yesterday's business day when the
cron runs, so it receives the report for the day before yesterday; move the
cron later if such a club needs yesterday's report. Migration
`041_supabase_daily_report_cron_and_delivery_audit.sql` creates the named job and
reads its bearer credential from Supabase Vault; migration
`073_daily_report_cron_0800_tashkent.sql` idempotently reschedules it to 08:00.

The retry route files are recovery entry points, not independent production
schedules. They are separate Vercel functions, so `vercel.json` lists the same
`includeFiles` for all three route files.

## Required configuration

Configure these only in trusted server/deployment environments:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `TELEGRAM_BOT_TOKEN`
- At least one complete `TELEGRAM_<TARGET>_CHAT_ID` and
  `TELEGRAM_<TARGET>_CLUB_ID` pair

Optional: `TELEGRAM_<TARGET>_OWNER_CHAT_ID`, an owners-only group for messages
admins must not see. Today that is the cash-shortage notice (`/api/cash-shortages`,
migration 135). Without it the notice is not sent at all; it never falls back to
the club group (`ownerChatId` in `clubChat.ts`). Create a Telegram group with
only the owners and the bot, then set its id here and redeploy.

The club group also gets instant notices from the routes that save money
changes (daily cash, expenses, exchanges, collections, salaries).
Every correction is announced too: expense edits from Entry details and daily
income edits (`PATCH /api/daily-cash`, never a direct browser write) post an
"✏️ Изменён…" message listing each field as old → new. Owner reserve changes go
through `/api/reserve` for this reason: every deposit, return to profit and
deleted entry posts one message naming the month whose profit the money left or
joined. "Put all in" sends one message for all its method parts. Purchases paid
from the reserve are expenses and are announced by `/api/expenses`.

Supported target keys are `pixel`, `main`, and `bunker`. `CRON_SECRET` must be a
header-safe random string of at least 16 characters and must match the value
stored in Supabase Vault.

Before applying migration 041, create/update the Vault secret used by the cron:

```sql
select vault.create_secret(
  '<the deployment CRON_SECRET value>',
  'game_club_daily_report_cron_secret',
  'Bearer token used by the Game Club daily finance report cron'
);
```

After changing the deployment secret, redeploy so the function and scheduler
use the same value. Never commit or print the actual values.

## Deployment order

Apply migrations 037 and 038 before deploying application code that depends on
the delivery ledger and snapshot/payment integrity. Apply migration 041 only
after its Vault secret exists.

If application code arrives before the required database migration, the route
fails closed with HTTP 500 and sends nothing. A later recovery run can catch up
the same business date after the migration is applied.

## Historical values

Warehouse value uses each product's latest saved closing count on or before the
report date, looking back to the start of the previous month (the same window
feeds the previous-month comparison). A product last counted before that window
is not included. Active debts are the balance at the end of the report date:
debts recorded later are excluded and payments recorded later are added back to
the live remaining amount, so recovery runs for past dates are not distorted by
later collections.

## Promo giveaways section

When migration 078 is applied, the report adds "Бонусы по акциям": the units
handed out free on the report date per product (with the promotion name), their
total and their cost. `getPromoGiveawayRows` reads report-date
`daily_stock_counts` rows with `giveaway_quantity > 0`; on an older database
the read fails and the section is omitted without blocking the report. The
cost is already inside bar cost, so no total changes.

## Bar write-offs image

When bar stock was written off or corrected on the report date, the cron sends
the report and a second image ("Списания и корректировки бара",
`buildStockAdjustmentsReportSvg`) together as one two-photo album
(`sendTelegramPhotoAlbum`, Telegram `sendMediaGroup`, caption on the first
photo): tiles for недостача, просрочка and
корректировка, then each product with its reason, note, units and value at
cost. Days with neither send nothing extra, and the main report image no longer
carries the write-off card (the caption and text fallback keep their totals).
`getStockWriteOffRows` reads report-date `daily_stock_counts` rows with a
non-zero adjustment; `summarizeStockWriteOffsForReport` keeps shortage/expired
and `summarizeStockCorrectionsForReport` keeps `correction` reasons, so older
free-text adjustments are not listed. The album is the report's one delivery: the ledger records it as `photo` with
`photoCount` (2 or 3), and retries resend the whole album. When the morning
Google review run left an "AI bot" image waiting (migration 173, see
`google-business-profile.md`), it is the album's last photo, so a day can
send the report and that image as an album even without write-offs. Only when the report image
itself falls back to text is the write-offs image sent after it, once and
best-effort (failure logged as `telegram_report_write_offs_image_failed`). The
result reports `writeOffsImageSent`.

Corrections send no instant group notice when saved
(`shouldNotifyStockAdjustment`; `/api/stock-write-offs` also skips them); they
appear only in this album. Write-offs still send their instant notice.

## Low-stock section

The report lists active, inventory-tracked products that are out of stock or at
or below their `low_stock_threshold` (default 5, via `listLowStockProducts` in
`src/lib/calculations/stock.ts`). It uses live `products.current_stock` at send
time, not the report date's saved closing counts, so a recovery run for an old
date shows today's stock. The section appears only when at least one product
qualifies; the caption does not count them (the image lists them). If the
products read fails, the section is omitted and the finance report is still sent.

## Caption: where the money is

The album caption carries no title or date (the image has both). It opens with
the three places of Reports' "Where the money is" and their total, at the end of
the report date: `👛 У администратора` (each method's money left this month
less what collected money holds, `moneyStillHeldByMethod`, the same function as
Reports' "With the admin" card), `💼 Собрано` (collected money still held,
`get_collected_money_moves` from the 1st), `🏦 В резерве` (the reserve's sums,
plus its USD account's dollars when there are any) and `💰 Всего денег` (the
three in sums; the dollars stay apart, never converted). The reserve is read
from its ledgers (`fetchOwnerReserve`, `reserveHoldingsOn`) because
`get_owner_reserve_balances` answers only a signed-in owner and the cron runs
under the service role. Migration `186_collected_money_moves_service_role.sql`
grants `get_collected_money_moves` to the service role explicitly. The reserve
is read strictly (`fetchOwnerReserve(..., { strict: true })`): unlike the
Reserve page, a failed dollar-expense or purchase read is not shrugged off, since
it would overstate the reserve. If any of it cannot be read, or the database has
no reserve (136), the four lines are left out and the report is still sent. The flags (internet, promo bonuses,
write-offs, corrections, money checks) follow unchanged.

## "Оплаты за день" (payments of the day) section

The day image has a card under the Club / Bar breakdown, above "Стоит
проверить", with one tile per payment method for the report date's Game Club
money (`calculateGameClubDayByPaymentMethod` in
`src/lib/calculations/dashboardMetrics.ts`): the day's cash-entry takings plus
debt payments received that day in, the day's Game Club expenses out (bar-paid
and reserve-paid ones excluded), and in − out as the big figure, with each
method's share of the day's takings. Exchanges and reserve moves are not part
of it. Bar sales have no payment method, so the bar is not in it.

It shows the club's `enabled_payment_methods` plus any other method that moved
money that day, and PlayStation only when it moved money. If the club's
methods cannot be read, every method is shown. A day where no method moved
money has no card, and the image is laid out exactly as before. The text
fallback lists the same figures; the caption is unchanged.

## "Стоит проверить" (worth checking) block

The report adds a short "🔎 Стоит проверить" block (text, caption count and a
card on the day image, above low stock) when the money checks from
`src/lib/calculations/moneyChecks.ts` find something dated the report date:

- a duplicate expense that day (same category, amount, side and method;
  salaries, shortages and reserve-paid expenses are exempt), and
- a low day: game-club income or bar sales under 60% of the same weekday over
  the previous eight weeks (at least four samples).

At most three lines, danger first. Category spikes and repeated shortages are
month-level and are not shown (shortages have their own owners-only notice).
No checks means no block, and the day image is laid out exactly as before.

A low day is only judged once the day is closed and has a daily-cash entry:
the day must be before the club's current business date when the report is
built (`getReportMoneyChecks`). The scheduled run always reports a closed
day; a dry run or forced resend for a day still in progress shows duplicates
only. A day whose entries are still partial when the cron runs is judged on
what the report itself shows.

Daily cash and stock counts are read from eight weeks before the report date
(or the comparison window, whichever is earlier) in the same single read; the
rest of the report still uses the comparison window. If the club's business
day cannot be read or the checks throw, the block is omitted
(`money checks unavailable` / `business day unavailable` in the logs) and the
report is sent as usual.

## Internet payment reminder

Owners set each club's internet payment day (1-31, or none) in Settings; it is
stored in `clubs.internet_payment_day` (migration 087). The report sent on the
calendar day before that date (Tashkent time, regardless of business-day start)
adds `🌐 Завтра оплата интернета` to the caption and the text report. A day past
the end of a short month falls on its last day, so day 31 reminds on the 29th
of a 30-day month. The reminder keys off the send time, so a recovery or
forced resend on another day does not carry it. If the column is missing or
unreadable, the reminder is omitted and the report is still sent.

## Activity notices

Changes investors should hear about that have no notice of their own (new and
edited products, saved stock counts and corrections, promotions, team access,
club settings, planned expenses, owner withdrawals and profit carryovers, stock
purchases, new debts and debt payments, a removed collection, collected money
moved to the reserve, and the removal or later salary recovery of a cash
shortage) are announced one message per change:

```text
database trigger -> entry_audit_logs row, notice_pending = true (183)
  -> announceActivity(clubId) after the page's save -> POST /api/activity (any member)
     or deliverActivityNotices() in a server route's after()
  -> claim_activity_notices (service role; each row once, oldest first)
  -> names (profiles, products, employees, debts, shortages)
  -> src/lib/telegram/activityNotification.ts -> sendTelegramMessage
```

- Capture is in the database, so the message reports what was saved, whichever
  page or route saved it. Rows of one record by one person in the same claim
  become one "Поле: было → стало" message, showing only the fields those rows
  changed.
- Cash shortage messages go to the owners' group (`TELEGRAM_*_OWNER_CHAT_ID`)
  and are dropped when it is not set; everything else goes to the club group.
- Not announced again here: a bar write-off alone (`/api/stock-write-offs`), a
  purchase moving stock or cost (the purchase notice, which names a new sale
  price), the evening's first count over a write-off saved earlier that day,
  salary employee details and job titles (`/api/salaries`), a salary payment
  method correction (`PATCH /api/expenses`), and a recovery saved together with
  its shortage (the shortage notice).
- Sending stops at the first failure. The unsent claimed rows, and the failed
  one when Telegram certainly did not take it (rate limit, server error, no time
  left), go back to pending (`release_activity_notices`). A message whose fate
  is unknown is logged (`[telegram/activity] notice failed`) and never resent.
- A page call sends one round of up to 10 notices, every send finished within
  45 s of the request (the route's `maxDuration` is 60 s); the rest waits. One
  "withdraw all" (142) of several methods and the bar is one message.
- Safety net: after every report is sent, the cron unmarks all clubs' pending
  rows older than 3 days (`expire_activity_notices`, also for clubs with no
  group), then sends one round of up to 10 per configured club, every send
  bounded by the run's deadline. The rest waits for the next page call or night.
- Without a bot token or any group for the club nothing is claimed. Nothing
  before migration 183 is announced.

## Rendering behavior

The route statically imports the Sharp renderer so Vercel traces the native
dependency. `vercel.json` includes Linux libvips and the Noto Sans TTF assets.
The font setup is evaluated before Sharp and creates a private fontconfig file,
so Russian labels do not rely on host-installed fonts.

If image generation fails before dispatch, the route logs the rendering error
and sends the same finance report as Telegram text, truncated at a line break to
Telegram's 4096-character limit if necessary. Once dispatch begins, a
transport problem follows delivery-ledger recovery rules; it does not switch
format and risk a duplicate. The one exception is Telegram refusing the image
itself (`400 IMAGE_PROCESS_FAILED` or `PHOTO_INVALID_DIMENSIONS`,
`isTelegramImageRejection`): that rejection posts nothing, so the route tries
the photo (or album) once more and then sends the same report as text in the
same run, logging `telegram_report_image_rejected`. Before this, such a
rejection failed the day with no report (22 Nov 2026, both Pixel clubs).

Generate a local PNG preview from a real club/date without sending Telegram:

```bash
npx tsx scripts/generate-daily-finance-preview.ts 2026-08-27
```

## Delivery safety model

Migration 037 provides a service-only delivery ledger. Scheduled delivery is
unique by business date, target, and the fixed `scheduled` delivery key.
Intentional resends use `force:<uuid>`.

The route durably marks dispatch before contacting Telegram. A timeout, network
failure, malformed success response, or interrupted post-send finalization has
an unknown outcome. It is quarantined as `manual_review`; automatic recovery
must not resend it.

For `manual_review`:

1. Inspect the delivery row and structured error.
2. Check the target Telegram group for the expected report.
3. If the message exists, do not resend; reconcile the operational state.
4. If it is confirmed missing, perform one intentional forced resend.

If a claim request errors and its retry then reports the delivery as
`in_progress`, the first claim may have committed with its response lost. The
route returns a failure (HTTP 500, `stage: claim`) and logs
`telegram_report_delivery_claim_ambiguous`; nothing is sent, and a later
recovery run can reclaim the row once its lease expires.

Each invocation keeps 15 seconds of its 60-second `maxDuration` for ledger
finalization. Build, claim, and Telegram retries stop before that point; an
in-process Telegram retry waits at most 3 seconds. A send that does not fit is
recorded as a retryable failure (with `retry_after` when Telegram supplied one)
for a later recovery run.

Telegram message deletion is not treated as a delivery-state change.

## Dry runs and intentional resends

Use the protected endpoint with `dryRun=1` to build results without Telegram
delivery. Dry runs cannot be combined with forced delivery.

`date` must be a real `YYYY-MM-DD` calendar date. A scheduled (non-forced,
non-dry-run) request with an explicit `date` must name a day strictly before
the target club's current business date; otherwise it returns HTTP 400 without
claiming the once-per-day `scheduled` slot, which a partial report would
otherwise burn. Use `dryRun=1` to preview an open day.

An intentional resend must specify exactly one date, one target, `force=1`, and
a caller-generated UUID:

```text
/api/cron/daily-finance-report?date=2026-08-26&target=pixel&force=1&requestId=40c05af5-5a59-45ae-a891-19a18228a721
```

Reuse the same `requestId` when retrying the same intended resend; it returns
the stored delivery rather than sending again. Generate a new UUID only when a
new Telegram message is explicitly intended.

## Verification

Relevant coverage includes:

- `src/lib/telegram/dailyFinanceReport.test.ts`
- `src/lib/telegram/dailyFinanceReportImage.test.ts`
- `src/lib/telegram/sendDailyFinanceReport.test.ts`
- `src/lib/telegram/reportDelivery.test.ts`
- `src/lib/telegram/reportDeliveryMigration.test.ts`
- `src/lib/telegram/dailyFinanceReportDeployment.test.ts`
- `src/lib/telegram/reportRecoveryCron.test.ts`
- `src/app/api/cron/daily-finance-report/route.test.ts`

Run the full quality checks after transport, ledger, deployment, font, route, or
financial-report changes.

