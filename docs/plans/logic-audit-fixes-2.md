# Logic audit fixes (batch 2)

Source: the 28 Nov 2026 logic audit (batch 1 shipped in 906f2bb, see
`logic-audit-fixes.md`). The owner approved fixing bug 7 and the smaller
items. Three builders work in parallel on disjoint files; each group below
names its files. Copy changes go to en/ru/uz together; only group B edits
`src/messages/*.json`; groups A and C report the keys and text they need.
Update skeletons whenever a page's shape changes.

Left out on purpose: the withdrawal trigger (051) and carryover (071) using the
Tashkent calendar month instead of the club business date. It has no effect
today and fixing it replaces two owner-money RPCs; do it only if asked.

## Group A: Reports and the daily/monthly reports

Files: `src/app/(dashboard)/reports/*`, `src/lib/calculations/moneyReport.ts`,
`src/lib/calculations/collectedMoney.ts`, `src/app/(dashboard)/daily-report/*`,
`src/app/(dashboard)/monthly-report/*`, `src/lib/detailLinks.ts` (if a new
link builder is needed), their tests, `e2e/` specs for these pages.

A1 (bug 7). Reports "Where the money is" (With the admin / Collected / In the
reserve, `ReportsPage.tsx` ~555 and ~1191): it mixes the picked range with
today's reserve, and a range spanning months adds last month's leftover to the
kassa although the till starts each month at zero. Make the three pots always
describe **now**: the till and collected held as of the current business date
for the current business month (the database's `method_daily_balances` /
`get_collection_balances` logic, or the existing app calculation run for
month start → today), plus today's reserve. Label the block as "now" when the
picked range is not the current month. Keep the three figures separate.

A2. Reports headline vs method cards on a mid-month range: the cards include
money from earlier in the month (`withOpeningBalances`), the "Game Club left"
headline does not. Show a "From earlier this month: X" line under the
headline when an opening balance applies (X = the opening total the cards
add), so the cards visibly sum to headline + opening.

A3. Reports "US dollars" card (`moneyReport.ts` ~325) shows movement in the
range and goes negative. Show dollars held at `range.to` as the main value and
the range's movement as a sub-line.

A4. Daily report "Debt income" (new debt principal) links to debt payments
(`DailyReportPage.tsx` ~113). Link it to the new debts for that date (the
Debts page filtered to that date, or the Reports entries with the new-debt
category, whichever exists; check `detailLinks.ts`). Same on the Monthly
report if it has the figure.

A5. Daily and Monthly report Game Club / Bar **profit** link to money-left
pages whose totals differ. Link profit to Financial Analysis for that period
(monthly tab / the day's month) instead; keep the cash-left figures linking to
money details.

## Group B: Dashboard and Financial Analysis

Files: `src/lib/calculations/dashboardMetrics.ts`, `dashboardSnapshot.ts`,
`financialAnalysis.ts`, `src/app/(dashboard)/dashboard/*`,
`src/app/(dashboard)/financial-analysis/*`,
`src/components/financial-analysis/*` (do not change chart look or behaviour;
the chart work just shipped), `src/lib/supabase/dashboardSnapshot.ts`,
`src/lib/supabase/analysisLedgers.ts`, `src/lib/assistant/loaders.ts` (B5
only), `src/messages/*.json`, their tests.

B1. "vs last month" (`dashboardMetrics.ts` ~263, 277-283, used by
`DashboardPage.tsx` and `FinancialAnalysisPage.tsx`): while the month is in
progress, end both the current and the previous comparison period at the
current period's latest entered day per side (the same rule the averages use,
`getAverageIncomeDayCounts`), so an unentered today is not compared with a
full day.

B2. Overall analysis (`financialAnalysis.ts` ~463-475): leave the unfinished
current month out of average monthly profit, best, worst and loss-month
counts; it may still be listed, labelled "so far".

B3. Dashboard on a past month shows today's active debts
(`dashboardSnapshot.ts` ~184). Show debts open at the end of that month
(debts dated on or before month end minus payments on or before month end),
or hide the figure for past months if that data is not available to the
snapshot; prefer the first.

B4. Current inventory value excludes deactivated products that still hold
stock, while last month's closing value includes them. Make both use the
same product set (include deactivated, not-deleted products with stock in
the current value, or exclude them from the comparison; prefer including).

B5. Compatibility fallbacks (`src/lib/supabase/dashboardSnapshot.ts` ~161,
`analysisLedgers.ts` ~72, `src/lib/assistant/loaders.ts` ~131) do not select
`paid_from_reserve` and (dashboard) skip reserve moves. Select the field and
pass reserve moves like the main path, guarded so older databases without the
column still work (follow the existing fallback pattern).

B6. `deletedOnBusinessDate` (`dashboardMetrics.ts` ~636) calls
`serverTodayIso(deletedAt)` with start hour 0; pass the club's business-day
start hour from every caller (dashboard and Telegram).

## Group C: Owner Profit, Debts, checks, Bar money details, Telegram

Files: `src/app/(dashboard)/money-taken/*`, `src/app/api/reserve/route.ts`,
`src/lib/calculations/debt.ts`, `src/app/(dashboard)/debts/*`,
`src/app/(dashboard)/test-checklist/*`,
`src/app/(dashboard)/bar-money-details/*`, `src/lib/telegram/*`, their tests.

C1. "Put all in" (`MoneyTakenPage.tsx` ~875-891, `/api/reserve`) can save
some methods and fail the next while showing only an error. Return which
parts were saved and which failed from the route, and show that in the toast
("Put in: cash 500 000. Not put in: terminal — reason"), then reload.

C2. Profit history month chips (`WithdrawalHistory.tsx` ~84-99, 153-161) add
Game Club and Bar together for "invested" and "reserved" under the "All"
filter. Show each side's own figure instead (the withdrawn total is the only
allowed combined figure).

C3. Debtor count (`debt.ts` ~135) uses a different key from the list grouping
(`debtPersonKey`). Use `debtPersonKey`.

C4. Test checklist overpaid-debt check (`TestChecklistPage.tsx` ~92-96, 213)
only reads unpaid debts, so it can never fail. Read every debt for the club
and flag `paid_amount > amount` or `remaining_amount != amount - paid_amount`.

C5. Bar money details compatibility fallback (`BarMoneyDetailsPage.tsx` ~68)
passes no reserve moves; pass them like the main path. Same for the Reports
expenses fallback select missing `paid_from_reserve` (`ReportsPage.tsx`
~395-401) — that file belongs to group A, so group A does that one line.

C6. Telegram stock value (`sendDailyFinanceReport.ts` ~586-587) only sees
counts from the comparison window; use each product's latest count on or
before the date (as `calculateInventoryValueFromLatestStockCounts` expects),
with `fetchAllRows` and `club_id` scoping.

## Tests

Each item gets a unit test of its pure logic; page changes that alter what a
browser spec asserts update `e2e/` in the same change.
