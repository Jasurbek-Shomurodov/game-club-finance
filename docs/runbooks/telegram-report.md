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

## Low-stock section

The report lists active, inventory-tracked products that are out of stock or at
or below their `low_stock_threshold` (default 5, via `listLowStockProducts` in
`src/lib/calculations/stock.ts`). It uses live `products.current_stock` at send
time, not the report date's saved closing counts, so a recovery run for an old
date shows today's stock. The section and the caption count appear only when at
least one product qualifies. If the products read fails, the section is omitted
and the finance report is still sent.

## Internet payment reminder

Owners set each club's internet payment day (1-31, or none) in Settings; it is
stored in `clubs.internet_payment_day` (migration 087). The report sent on the
calendar day before that date (Tashkent time, regardless of business-day start)
adds `🌐 Завтра оплата интернета` to the caption and the text report. A day past
the end of a short month falls on its last day, so day 31 reminds on the 29th
of a 30-day month. The reminder keys off the send time, so a recovery or
forced resend on another day does not carry it. If the column is missing or
unreadable, the reminder is omitted and the report is still sent.

## Rendering behavior

The route statically imports the Sharp renderer so Vercel traces the native
dependency. `vercel.json` includes Linux libvips and the Noto Sans TTF assets.
The font setup is evaluated before Sharp and creates a private fontconfig file,
so Russian labels do not rely on host-installed fonts.

If image generation fails before dispatch, the route logs the rendering error
and sends the same finance report as Telegram text, truncated at a line break to
Telegram's 4096-character limit if necessary. Once dispatch begins, a
transport problem follows delivery-ledger recovery rules; it does not switch
format and risk a duplicate.

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

