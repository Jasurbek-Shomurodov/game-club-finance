# Logic audit fixes (batch 1)

Source: the 28 Nov 2026 whole-app logic audit. The owner approved fixing bugs
1 to 6. Each slice below is independent and leaves `main` working. Another
session is working on charts in this checkout at the same time
(`docs/plans/finance-style-charts.md`, `src/lib/chart*.ts`, chart components):
do not touch those files, and preserve any unrelated changes in the tree.

## Slice 1. Write-offs cannot erase a day's saved sales

Problem: `/write-offs` (`WriteOffsPage.tsx`) and the write-off dialog on
`/closing-stock` (`ClosingStockPage.tsx` `handleWriteOffSave`) rebuild the
product row from the copy loaded when the page opened and send it through
`save_closing_stock_counts`. That RPC (latest body in migration 164; see 167
for corrections) does not compare with the saved row, so a stale page
overwrites `sold_quantity` saved later on another device. The Closing Stock
dialog re-sends every row.

Fix:
- New migration `188_record_stock_write_off.sql`: an additive function
  `record_stock_write_off(...)` with the same membership/permission checks the
  write-off path has today (admins may record write-offs, migration 164). It
  locks and reads the **saved** row for that club/date/product (or builds the
  open-day row exactly as the current save path would when none exists),
  applies the write-off as a delta to the adjustment and closing quantity
  while keeping the saved `sold_quantity`, and saves through the same logic
  (call `save_closing_stock_counts` with the recomputed single row, or share
  its internals) so every existing check and forward recalculation still runs.
  Match whatever the current write-off carries (quantity, reason/note, cost).
  Do not replace or drop `save_closing_stock_counts`.
- Both pages call the new RPC for a write-off and then reload the day. The
  Closing Stock dialog sends only that product, never the whole sheet.
- Run `npm run migrations:manifest`.

Tests: a PGlite/migration test (follow existing RPC tests) proving: saved row
with sold 15, write-off of 2 recorded from stale data → sold stays 15, closing
drops by 2; write-off on a day with no saved row behaves as today. Update unit
tests and `e2e/` specs covering write-offs if the request changes.

## Slice 2. Salaries accept the "Game Club income" KPI basis

Problem: `save_salary_employee` (070) and `change_salary_term` (123) raise
"Invalid KPI settings" unless the basis is `owner_profit` or `overall_profit`.
Migration 134 added `game_club_income` to the check constraint only. So the
UI option always fails, and a same-day salary change for an employee already
on that basis fails.

Fix: migration `189_salary_game_club_income_basis.sql` re-creates both
functions from their latest bodies with the basis check widened to include
`game_club_income`; for that basis the pools must be Game Club only (134's
check constraint), so normalise to `kpi_game_club = true, kpi_bar = false`.
Keep every other line identical. Run `npm run migrations:manifest`. Add a
PGlite test for create and same-day change on `game_club_income`.

Slices 1 and 2 are built by one builder (both regenerate the manifest).

## Slice 3. Month forecast stops multiplying one-off costs

Problem: `analysisSeries.ts` `sideForecast` sets
`projectedProfit = profitToDate × daysInMonth / daysCounted`, so a monthly
rent paid on the 1st is projected ~30 times; it also projects from one day.
Used by Financial Analysis → Overall (`OverallAnalysis.tsx`), the assistant's
outlook (`src/lib/assistant/datasets.ts`) and the Telegram image
(`dailyFinanceReportImage.ts`).

Fix (in `analysisSeries.ts`, consumers unchanged where possible):
- Projected income stays a linear scale of income to date.
- Projected spending = spending so far + what is still expected: bar cost of
  goods sold scales with bar sales; expenses stay at their amount to date plus
  the remaining planned amount of active expense presets for that side still
  due this month (use the helpers in `expensePlans.ts` / `upcomingPayments.ts`
  if the forecast's inputs allow; if plan data is not available to it, keep
  expenses at their amount to date). Projected profit = projected income −
  projected spending.
- No projection (null) until the side has the dashboard's minimum days
  (`MIN_PROJECTION_DAYS`); reuse that constant.
- Keep the output shape; update the daily projected series if it uses the
  same scale.

Tests: the audit's case (2 Nov, 3 000 000 income on the 1st and 2nd,
20 000 000 rent on the 1st) must not give a projection near −210 000 000; add
cases for remaining planned spend and the minimum-days rule.

## Slice 4. Daily/Monthly report "Bar cash left" counts the owner reserve

Problem: `dailyReport.ts` `barCashLeft: barMoney - barExpenses` ignores bar
deposits into the owner reserve and bar purchases paid from the reserve,
while Reports `barLeft` (`moneyReport.ts`), the dashboard
(`dashboardMetrics.ts`) and `/bar-money-details` (`moneyDetails.ts`) apply
them. Used on `/daily-report` and `/monthly-report`.

Fix: compute Daily/Monthly bar cash left with the same canonical bar
money-left calculation the dashboard uses, with the period's reserve moves
(loaded as the dashboard / bar money details do, scoped by `club_id`). Do not
change accounting profit. The figure must equal the dashboard and
`/bar-money-details` for the same range.

Tests: a unit test with a bar reserve deposit and a reserve-paid bar purchase
showing Daily/Monthly bar cash left equals the dashboard figure.

Slices 3 and 4 are built by one builder.

## Slice 5. Reserve "Return" limit matches the database

Problem: `reserve/ReserveReturnModal.tsx` limits a return to
`reserveBalances().game_club.byMethod[method]` (deposits − returns −
purchases) and `bar.held`; `return_owner_reserve` (migration 162) allows
`least(owner_reserve_bucket_net, owner_reserve_sums_held)` where the bucket is
deposits − returns (no purchases; since 155 every purchase from the reserve's
sums is stored as Game Club cash).

Fix: a pure helper in `ownerReserve.ts` (beside `reserveBuyLimits`, reusing
its pieces) giving each bucket's return limit = min(bucket deposits −
returns, reserve sums held), used for the per-method chips, the Bar option and
the form's cap. Unit tests for: deposit 5M terminal then a 3M purchase → 2M;
5M cash + 5M bar then a 6M purchase → cash 4M, bar 4M.

## Slice 6. Owner Profit "In the reserve" shows sums and dollars separately

Problem: `money-taken/ReserveSection.tsx` uses
`held = game_club.held + bar.held`, which includes the UZS paid for the
reserve's dollars, then appends the dollars. `/reserve` shows the sums alone
(`reserveSumsHeld`).

Fix: show the sums with the same function `/reserve` uses and the dollars as
their own figure. Keep it tappable to `/reserve`; update its skeleton if the
shape changes; copy changes go to en/ru/uz together.

Slices 5 and 6 are built by one builder.

## Risks

- Slice 2 replaces two payroll RPCs (bodies unchanged except the basis check).
  Slice 1 only adds a function.
- Another session edits chart files in this checkout; commits must include
  only this batch's files.
