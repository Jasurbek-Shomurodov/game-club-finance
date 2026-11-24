# Payment history card for planned expenses

## Goal and user flow

On Financial Analysis (Monthly), the "Planned vs actual expenses" section
shows one panel per side. A club with plans on one side only (the usual case:
game club plans, no bar plans) has an empty half. A third card fills it with a
fact the page does not show yet: **what was actually paid against each plan in
each of the last six months**.

The owner reads it as "did we pay rent every month, and how much?": one row per
plan, one column per month, each cell the total paid that month. Tapping a cell
opens Reports with that month's payments for the plan's category and side.

## Placement

`/financial-analysis`, Monthly tab, inside the existing `planSection` grid, as
its last card (system-design rule: a new fact joins the page that already owns
the thing). No new page, sidebar item, table, RPC or permission.

- One plan panel shown: the card takes the free grid cell beside it.
- Both panels shown: the card goes on the next row and spans both columns
  (`lg:col-span-2`).
- Shown only when at least one plan row exists (not for suggestions alone).

## Architecture

### Calculation (new, pure, tested)

`src/lib/calculations/planPaymentHistory.ts` (+ `.test.ts`)

```ts
export const PLAN_HISTORY_MONTHS = 6;

export interface PlanHistoryCell {
  month: string;          // 'YYYY-MM'
  range: { from: string; to: string }; // the whole calendar month
  paid: number;           // sum of linked payments in the month, 0 when none
  count: number;
}
export interface PlanHistoryRow {
  preset: ExpensePreset;
  cells: PlanHistoryCell[];   // oldest first, always PLAN_HISTORY_MONTHS long
  paidMonths: number;         // cells with paid > 0
}
export interface PlanHistorySide { rows: PlanHistoryRow[] }
export interface PlanPaymentHistory {
  months: string[];           // the column months, oldest first, ending with the selected month
  gameClub: PlanHistorySide;
  bar: PlanHistorySide;
}
export function planHistoryStart(range: Range): string; // first day of the month 5 months before range.from
export function buildPlanPaymentHistory(input: {
  summary: ExpensePlanSummary;              // rows and their order come from here
  linkedExpenses: readonly PresetExpenseRow[];
  range: Range;                             // the selected month
}): PlanPaymentHistory;
```

- Rows are exactly the rows of `summary` for each side, same order (so archived
  plans with spending in the selected month appear, like in the panels).
- Sides are never added together; there is no cross-side total.
- No "missed" judgement and no comparison with the plan amount for past
  months: a preset keeps only its current `monthly_amount`, so an old month's
  plan is unknown. The card states facts (paid amount or nothing).
- Reuse the month helpers already in `upcomingPayments.ts` (export them or move
  them to a shared spot) instead of writing date maths a third time.

### Data

`FinancialAnalysisPage.tsx` `loadPlans`: read linked payments from
`min(usualDayHistoryStart(range), planHistoryStart(range))` through `range.to`
for every month, not only the current one. `buildExpensePlanSummary` and
`buildUpcomingPayments` already filter by date, so nothing else changes. Still
one `fetchPresetExpenses` call; check it uses `fetchAllRows` or otherwise is
safe above 1 000 rows.

### Component

`src/components/financial-analysis/PlanPaymentHistoryCard.tsx`, exporting
`PlanPaymentHistoryCard` and `PlanPaymentHistoryCardSkeleton`.

- `ChartCard` with title, a one-line description and an `IconChip`
  (`History` or `CalendarCheck` icon, neutral tone) as action, matching
  `ExpensePlanPanel`.
- A compact grid: first column the plan name (truncated), then six month
  columns headed with `formatMonthShort`. The selected month's column is
  marked (stronger header text). When both sides have rows, a small side
  subheading (game club / bar, using the existing dashboard labels) separates
  them; with one side there is no subheading.
- Cell: paid > 0 shows the amount in compact form in the side's tone (primary
  for game club, bar tone for bar) on a soft tinted pill; nothing paid shows a
  muted dash. Compact form: millions with up to one decimal, thousands whole,
  with a translated unit suffix (messages, three locales), e.g. `24 mln`,
  `610 ming` / `24 млн`, `610 тыс` / `24M`, `610K`. Put the compact helper in
  `analysisFormat.ts` (or reuse one if the charts already have it: check
  `OverallCharts.tsx` axis formatting first). The full amount goes in the
  cell's accessible label: "Arenda, October 2026: 24 000 000 UZS".
- Each cell with a payment is a link (`Link`, same focus ring as `PlanRow`) to
  `reportsHref(cell.range, { category: 'expense:<category>', source })`; only
  when the member can open `/reports` (`canAccessPath`), otherwise plain text.
  A dash cell is plain.
- Under each row's name, a small muted line: "Paid in {paid} of {total}
  months".
- Must fit 375 px without horizontal page scroll: tabular numbers, `text-xs`
  cells, name column `minmax(0,1fr)`; if six columns cannot fit, the grid
  itself scrolls inside the card (`overflow-x-auto`), never the page.
- Colours from `tone.ts`, no new keyframes; the row list may use `.stagger`.

### Skeleton

Add the card's skeleton to the plan part of `AnalysisBodySkeleton` /
`FinancialAnalysisSkeleton.tsx` only if those already draw the plan section;
otherwise keep the skeleton exported for use while `planQuery` loads, following
what the plan panels do today.

### Translations

`financialAnalysis` in `en.json`, `ru.json`, `uz.json`: card title ("Payment
history"), description ("What was paid against each plan in the last six
months. Tap an amount to open its payments."), "Paid in {paid} of {total}
months", cell label, compact units.

## Tests

- `planPaymentHistory.test.ts`: six columns ending with the selected month
  across a year boundary; payments summed per month and per preset; rows and
  order follow the summary; payments outside the window ignored; sides kept
  apart; `paidMonths`.
- Compact formatter unit test.
- `e2e/`: only if an existing spec asserts the plan section's contents.

## Slices

1. Everything above (one slice: calculation, data range, card, skeleton,
   translations, tests). No migration.

## Risks

- A plan created recently shows dashes for earlier months; that is why a dash
  is neutral, not red.
