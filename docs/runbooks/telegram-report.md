# Telegram daily finance report runbook

Read this before changing or operating the scheduled Telegram report.

## Pipeline and ownership

Each configured target is built independently from that club's Supabase rows:

```text
Supabase data -> calculations -> SVG -> PNG -> Telegram sendPhoto
  -> delivery status saved
```

Supabase Cron owns the production schedule. It runs daily at `03:00 UTC`, which
is `08:00 Asia/Tashkent`, and invokes the production endpoint for the previous
Tashkent business date. Migration
`041_supabase_daily_report_cron_and_delivery_audit.sql` creates the named job and
reads its bearer credential from Supabase Vault; migration
`073_daily_report_cron_0800_tashkent.sql` idempotently reschedules it to 08:00.

The retry route files are recovery entry points, not independent production
schedules.

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

## Low-stock section

The report lists active, inventory-tracked products that are out of stock or at
or below their `low_stock_threshold` (default 5, via `listLowStockProducts` in
`src/lib/calculations/stock.ts`). It uses live `products.current_stock` at send
time, not the report date's saved closing counts, so a recovery run for an old
date shows today's stock. The section and the caption count appear only when at
least one product qualifies. If the products read fails, the section is omitted
and the finance report is still sent.

## Rendering behavior

The route statically imports the Sharp renderer so Vercel traces the native
dependency. `vercel.json` includes Linux libvips and the Noto Sans TTF assets.
The font setup is evaluated before Sharp and creates a private fontconfig file,
so Russian labels do not rely on host-installed fonts.

If image generation fails before dispatch, the route logs the rendering error
and sends the same finance report as Telegram text. Once dispatch begins, a
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

Telegram message deletion is not treated as a delivery-state change.

## Dry runs and intentional resends

Use the protected endpoint with `dryRun=1` to build results without Telegram
delivery. Dry runs cannot be combined with forced delivery.

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

