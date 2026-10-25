# Finance domain guide

Read this before changing dashboard totals, reports, owner money, Telegram
finance output, or the meaning of an accounting field.

## Sources of truth

| Concept | Current ledger |
|---|---|
| Game-club collections | `daily_cash_entries` |
| Bar sales and cost of goods sold | `daily_stock_counts` |
| Inventory cash outflow | `stock_purchases` |
| Operating expenses | `expenses` |
| Customer debt principal | `new_debts` |
| Cash collected from debts | `debt_payments` |
| Owner money taken | `owner_withdrawals` |
| Money moved between methods or into dollars | `money_exchanges` |

The older `income_transactions`, `expense_transactions`, and `cash_movements`
tables are retired ledgers. They remain readable for history but must not accept
new application writes.

Every row above is club-owned. Always scope reports and mutations by `club_id`.

## Canonical formulas

Use the implementations under `src/lib/calculations`; these definitions explain
their intent but are not a second implementation.

```text
gameClubIncome = cash + terminal + card + playstation + debtIncome
barSales       = sum(daily_stock_counts.bar_income)          -- sold units only
barCost        = sum(daily_stock_counts.bar_cost)            -- sold + promo giveaways, at cost
gameClubProfit = gameClubIncome - gameClubExpenses           -- expenses paid from game_club
barProfit      = barSales - barCost - barExpenses            -- expenses paid from bar
```

The game club and the bar are separate businesses. **Never add their money
together**: there is no combined income, combined spending, combined profit, or
share of a club + bar total, in the app, reports, assistant data, or Telegram.
Show each side's figures side by side instead. `totalExpenses` (every expense,
whichever money paid it) exists only for expense-category breakdowns.

Average daily income has one definition (`getAverageIncomeDayCounts` in
`dashboardMetrics.ts`), used by the dashboard and financial analysis: each side
divides its period income by the days from the range start through its own
latest entry in the range (game club: latest daily cash entry or new debt; bar:
latest stock count), or the full range when it has none.

Financial analysis labels `income - spent` per side as **Profit** (accounting
profit, after bar cost of goods sold). The dashboard's "Money left" is cash left;
do not label one as the other.

`debtIncome` in financial reports represents new debt principal for the period.
Debt payments are collections used in retained/available game-club money; do not
count the same cash as both new income and collection without checking the
specific report definition.

Promo giveaways (migration 078, see `inventory.md`) are units handed out free:
no income, cost included in `barCost`, repeated in `giveaway_cost`.

Accounting profit and available cash answer different questions:

- Cost of goods sold (`barCost`) reduces accounting profit.
- Inventory purchases are cash outflow and reduce bar cash left only on or after
  `STOCK_PURCHASE_DEDUCTION_START_DATE` (`2026-07-02`). This historical cutoff is
  defined in `src/lib/calculations/barMoney.ts`; do not duplicate or casually
  change it.
- An expense reduces the source selected by `payment_source`: `game_club` or
  `bar`.

```text
barCashLeft = barSales - qualifyingStockPurchaseCost - barExpenses
```

## Owner available money

`src/lib/calculations/availableMoney.ts` calculates independent monthly and
source-specific buckets:

```text
gameClubEarned = gameClubCollections + debtCollections - gameClubExpenses
barEarned      = barSales - qualifyingStockPurchases - barExpenses
available      = earned - prior withdrawals for the same month and source
```

Positive money in another month or source cannot validate an over-withdrawal.
The database RPC `withdraw_owner_money_for_month` atomically validates and records
a custom positive amount for one month. For `all`, it allocates Game Club first,
then Bar, without overdrawing either bucket; the form caps `all` at the sum of
the two positive balances, a withdrawal limit only and never a figure shown as a
club + bar total. Money Taken shows each side's remaining, earned and withdrawn
separately (`AvailableMoneyResult` has no combined totals). The legacy
`take_all_owner_money_for_month` remains available for older clients. Never
replace these RPCs with direct browser inserts.

Game Club withdrawals can be taken from one payment method
(`withdraw_owner_game_club_money_by_method`, migration 066). A method's
withdrawable amount is `min(method left for the month - method withdrawals,
Game Club available for the month)`; see `gameClubWithdrawalsByMethod` and
`availableForPaymentMethod` in `ownerProfitSnapshot.ts`. Withdrawals without a
method (older rows and `all`) are shown as unassigned, never guessed.

Unwithdrawn profit can be moved into the next calendar month
(`owner_profit_carryovers`, migration 071) through
`carry_owner_profit_to_next_month`; Game Club moves name a payment method and
land in the same method. A carryover is neither earnings nor a withdrawal:
reported earnings and withdrawn totals (including salary KPI on owner
withdrawals) are unchanged, while `available` becomes
`earned + carried in - carried out - withdrawn`
(`applyOwnerProfitCarryovers`). `delete_owner_profit_carryover` refuses when the
next month has already withdrawn or moved that money.

## Planned expenses

`expense_presets` (migration 091) is each club's own list of recurring costs
(Electricity, iCafe, Server maintenance, ...) with a monthly planned amount and
one money source. Staff pick a preset in the expense form and type the amount;
the expense stores `preset_id`, with the preset's category and source. It is an
ordinary expense in every total. Financial analysis compares plan with actual
per side through `buildExpensePlanSummary` in `expensePlans.ts`: the plan for a
range is each month's amount times the share of its days in the range, actual
is the sum of linked expenses. Unlinked expenses never count against a plan.
Archived presets keep their linked history but have no plan. Editing a monthly
amount changes the plan for past ranges too (there is no plan history).

## Money exchanges

`money_exchanges` (migration 092) moves Game Club money between cash,
terminal and card, or into and out of US dollars at a rate the user types
(UZS per $1). An exchange is neither income nor an expense: collections,
expenses and profit are unchanged. The "from" method loses `from_amount`, the
"to" method gains `to_amount` (`exchangeNetByMethod` in `moneyExchanges.ts`,
applied inside `calculateGameClubMoneyLeftByPaymentMethod`). Dollars are a
separate holding shown as their own Reports card and are never added to a
UZS total, so UZS sent to dollars lowers Game Club money left.

Owner per-method withdrawal limits follow exchanges: the 092 version of
`owner_payment_method_earned_for_month` includes them, and Money Taken adds
them to the 050 snapshot balances with `withExchangesByMonth`. Dollars cannot
be withdrawn. Members with the expenses feature record exchanges through
`record_money_exchange`; only owners delete (`delete_money_exchange`), which
also removes the club-group Telegram message.

## Debts

- New debts begin unpaid with `paid_amount = 0` and the full amount remaining.
- Payment dates cannot precede the debt date or use a future club business date.
- Payments cannot exceed the remaining debt.
- Debt and payment rows are append-only for application users.
- A database trigger updates the parent balance and status after payment insert.

Keep UI validation for feedback, but rely on database constraints/triggers for
integrity under concurrency or direct API access.

## Dates and periods

Browser/server finance pages use the selected club's configurable business-day
start from `src/lib/utils.ts`. Scheduled Telegram reporting uses
`Asia/Tashkent` and reports the previous Tashkent business date. A calendar
month owner bucket is stored as its first day (`YYYY-MM-01`).

## Change checklist

When a formula changes, inspect all consumers: dashboard, daily/monthly reports,
money details, owner money, Telegram report, and tests. Prefer changing one pure
calculation and its tests rather than fixing each consumer independently.

## Employee salaries

`src/lib/calculations/salaries.ts` is the canonical payroll calculation.
`salary_employees` identifies staff (independent of login/team memberships),
`salary_rates` preserves effective-dated daily/monthly rates, KPI and active
status, and `salary_entries` holds append-only payments, bonuses and fines.

Daily salary accrues on active calendar days including the current business
date. Monthly salary accrues proportionally to the actual calendar days in
that month. Changes/deactivation start today; historical rates stay intact.
Same-business-day settings can be corrected. KPI percentages are weighted by
eligible days over elapsed days in that month.

Each salary rate carries a KPI basis (migration 070) and the pools it draws from
(`kpi_game_club`, `kpi_bar`; at least one):

- `overall_profit` (default for all older rates): the Owner Profit **earned** cash
  of the ticked pools before owner withdrawals, calculated live every day. Add
  back linked salary payments paid from those pools, then deduct the group's
  fixed pay (base + bonus - fine). With `P` as that remainder and `r` as the sum
  of weighted KPI fractions of the group, remaining profit is
  `max(0, P) / (1 + r)`; each employee receives their fraction of it.
- `owner_profit`: only money the owner actually withdrew from the ticked pools
  in the month; KPI is the percentage of that amount, with no extra deduction.

Employees sharing a basis and pools form a group; groups are independent, so
overlapping pools with different groups are not netted against each other.
`get_salary_profit_snapshot` therefore exposes monthly withdrawn totals (never
individual withdrawal rows) to club members. Salary payment timing cannot
change KPI. Existing manual salary expenses remain ordinary expenses; do not
record the same payout again through payroll.

Employee balance = accrued base + KPI + bonuses - fines - payments. Negative
balances represent advances/credit and carry across months. Bonuses and fines
affect salary entitlement, not immediate cash. Payments create ordinary salary
expenses atomically, so current dashboards, owner money, reports and daily
Telegram totals already include their cash outflow without separate deduction.
Payroll balances/KPI are live estimates: later finance edits may change past KPI.
There is no closed payroll-period snapshot in this version.

Future salary employees are supported by migration `060_future_salary_employees.sql`. They accrue nothing before joining. `change_salary_term` changes only salary or KPI under the employee lock, effective on the club business date (or the future joining date), preserving the other terms and earlier rates.

Migration 062 adds audited deletion for salary entries and rates. `delete_salary_record` requires salary editing access and retains the original row with `deleted_at`/`deleted_by`. Payment deletion removes the linked expense atomically; direct payroll mutations remain forbidden. Calculations exclude deleted rows; history displays them. Deleting a rate extends the preceding rate until the next live rate and may change historical KPI/balances. Operations live at `/salaries`, employees at `/salaries/employees`, and individual history at `/salaries/employees/[employeeId]`.

Migration 065 preserves at least one live rate per employee. The Employee Settings
form can restore settings that were already deleted, effective today (or the
future joining date), without rewriting historical deleted rates. Payroll profit
inputs now use the member-authorized salary snapshot, independent of ledger
feature grants. Money Report expense totals include both payment sources;
method balances still deduct only Game Club expenses. Daily Cash uses the same
accounting-profit calculation as reports, including new debt principal and all
expenses; the metric is hidden when the member cannot read every required ledger.
