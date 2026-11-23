# Money check, upcoming payments and a sharper assistant

Ideas adopted from Anthropic's "Personal Finance in Claude" (November 2026),
fitted to this app. Bank linking and user-built dashboards are deliberately not
adopted: the app's data is entered by hand and its dashboard is purpose-made.

## Goal and user flow

The owner should be told what looks wrong and what is still to be paid, without
hunting through ledgers, and should be able to ask the assistant about both and
jump from its answer to the records.

1. **"Does anything look off?"** The app checks the month for duplicate
   expenses, a category far above its usual level, days with unusually low
   income and repeated cash shortages. The owner sees the list on Financial
   Analysis, can ask the assistant, and gets a short note in the Telegram daily
   report for anything found on the reported day.
2. **"What is still due this month?"** Planned expenses that are not paid yet
   are listed with their usual pay day, totalled per side. Regular expenses that
   have no plan are suggested as plans.
3. **Assistant answers open records and show charts.** A figure in an answer is
   a link to the page that lists the records behind it; a trend or split can be
   a small chart.
4. **"Can we afford it?"** The assistant combines the month-end forecast, what
   is still due and the money on hand to answer an affordability question, and
   says which figures it used.

## Placement (system-design.md section 2)

| Thing | Home | Other places |
|---|---|---|
| Money check list | `/financial-analysis`, Monthly tab, a "Worth a look" section directly under the headline row (rule 4: a summary across areas that is not needed every day) | Assistant dataset `checks`; Telegram daily report (reported day only) |
| Still due this month | `ExpensePlanPanel` on `/financial-analysis` (rule 1: a new fact about plans, which already live there) | Assistant dataset `upcoming` |
| Plan suggestions | `ExpensePlanPanel`, under the plan rows | none |
| Record links and charts | Assistant answers | none |

No new screen, sidebar item, table or permission key. The Dashboard is not
touched.

## Architecture

### Pure calculations (new, each with a test beside it)

`src/lib/calculations/moneyChecks.ts`

```ts
export type MoneyCheckKind = 'duplicate_expense' | 'category_spike' | 'low_income_day' | 'repeated_shortage';
export interface MoneyCheck {
  kind: MoneyCheckKind;
  severity: 'warning' | 'danger';
  side: 'game_club' | 'bar' | null;      // never both added together
  date: string | null;                    // the day it happened, when it is one day
  range: { from: string; to: string };    // the records behind it
  category?: string;                      // expense category key
  amount: number;                         // the figure that is off (whole UZS)
  usual?: number;                         // what it is compared with
  count?: number;                         // rows or days involved
  recordIds?: string[];                   // expense ids for duplicates
}
export function buildMoneyChecks(input: {...}): MoneyCheck[]
```

Detectors, with thresholds as named exported constants so tests pin them:

- **duplicate_expense**: two or more expenses on the same date with the same
  category, amount, payment source and payment method. One check per group;
  `amount` is the repeated amount, `count` the number of rows. Salary-category
  expenses are exempt (several people are legitimately paid the same amount on
  one day); read how salary payments are stored before deciding the exemption
  key.
- **category_spike**: per side and category, the selected month's total to date
  against the average of the same category over the previous three full months,
  scaled to the elapsed share of the month (`periodProgress`). Flag when it is
  at least 1.5× usual, the excess is at least 5% of that side's expenses for
  the month so far, and at least two of the three earlier months had the
  category. A category with a plan (`ExpensePreset`) is compared with its plan
  instead and is left to the plan panel: do not flag it here.
- **low_income_day**: a finished day whose game-club income is under 60% of the
  average of the same weekday over the previous eight weeks, with at least four
  samples. Days with no daily-cash entry at all are not flagged (a missing
  entry is not a low day). The bar gets the same check on bar sales, as a
  separate check with `side: 'bar'`. Today is never flagged.
- **repeated_shortage**: three or more cash shortages in the month, or shortages
  on three consecutive recorded days. `amount` is their total.

Sort: danger first, then newest date, then largest amount. Severity is `danger`
for duplicates and for a spike or low day beyond twice the threshold, otherwise
`warning`.

`src/lib/calculations/upcomingPayments.ts`

```ts
export interface UpcomingPayment {
  preset: ExpensePreset;
  remaining: number;          // planned for the month minus linked actual, floored at 0
  usualDay: number | null;    // median day of month of the last 6 linked payments
  dueDate: string | null;     // usualDay in the selected month, clamped to its last day
  overdue: boolean;           // dueDate before the business date and remaining > 0
}
export interface UpcomingSide { rows: UpcomingPayment[]; remaining: number }
export function buildUpcomingPayments(input): { gameClub: UpcomingSide; bar: UpcomingSide }
export interface PlanSuggestion { category: string; side: ExpensePresetSource; typicalAmount: number; months: number; usualDay: number | null }
export function suggestExpensePlans(input): PlanSuggestion[]
```

- Upcoming reuses `buildExpensePlanSummary` for planned and actual; it does not
  recompute them. Archived presets are skipped. Only the current business month
  has "upcoming"; a past month returns empty sides.
- A suggestion is a side + category with no active preset that had expenses in
  at least three of the last four full months, with monthly totals within ±25%
  of their median. `typicalAmount` is that median rounded to 1 000.
- Salaries owed are out of scope: balances are derived in the browser from all
  history (system-design.md section 8) and are not a monthly plan.

### Data loading

Reuse the queries the Monthly tab and `src/lib/assistant/loaders.ts` already
make (`get_finance_report_snapshot` rows, expense presets, cash shortages).
The checks need three earlier months of expenses and eight weeks of daily
income: extend the existing loads' range rather than adding parallel fetches,
and use `fetchAllRows` where a read can pass 1 000 rows. Every read stays
scoped to `club_id` and to the member's own Supabase client.

### UI

- `src/components/financial-analysis/MoneyChecksPanel.tsx` with an exported
  `MoneyChecksPanelSkeleton`. A `Card` with a `SectionHeading` and one row per
  check: `IconChip` in the check's tone (`warning`/`danger`), a one-line
  sentence, the amount on the right. Each row is tappable through `href`:
  duplicates and spikes open `reportsHref(range, { category: 'expense:<key>', source })`,
  a low day opens `dailyReportHref(date)`, shortages open Owner Profit (add a
  `cashShortagesHref()` helper to `detailLinks.ts` pointing at their home).
  When there is nothing to show, the section renders one quiet line ("Nothing
  unusual this month"), not an empty card with a heading.
- `ExpensePlanPanel.tsx`: each plan row gains its due state ("due around the
  12th", "overdue", "paid"); each side's total shows what is still due. Plan
  suggestions appear under the rows as a short list with a button that opens
  the existing create-plan form prefilled (one form component; do not build a
  second one).
- Skeletons: `FinancialAnalysisSkeleton.tsx`, `loading.tsx` and the in-page
  loading state get the new section in its place.
- Copy in `en.json`, `ru.json`, `uz.json` under the existing financial-analysis
  namespace; sentences are ICU messages with the amount and date formatted by
  `src/lib/formatters.ts`.

### Assistant

- New datasets `checks` and `upcoming` in `datasets.ts`/`loaders.ts`/`tools.ts`
  (`DATASET_HELP`, `allowedDatasets`: same access as the finance snapshot).
  Rows are built from the two calculation modules above, never re-derived.
- New dataset `outlook` (slice 6): one metric table with the month-end forecast
  per side (`buildMonthForecast`), still-due per side, and money left per
  payment method from the money dataset. Reserve balance only for members who
  can open `/reserve`.
- **Record links**: every `get_data` result carries `links`: a list of
  `{ label, href }` built with `detailLinks.ts` for that dataset and period
  (and per check row for `checks`). The prompt tells the model to link a figure
  to its records with a Markdown link taken from `links`, and never to write a
  URL that was not in a tool result. `AssistantMarkdown` renders an href that
  starts with a single `/` through `next/link` and renders any other href as
  plain text unless it is `https:`; add tests for `//host`, `javascript:` and
  backslash forms.
- **Charts**: a fenced block with the language `chart` holding JSON
  `{ type: 'bar' | 'line', title?, unit: 'money' | 'number' | 'percent', labels: string[], series: [{ name, values: number[] }] }`,
  validated with zod (max 2 series, max 62 points). `AssistantMarkdown` renders
  a valid block with the shared chart parts from `src/components/charts`
  (`chartColors`, `ChartTooltipBody`); an invalid or still-streaming block
  renders nothing rather than raw JSON. The prompt says when a chart helps (a
  trend over days or months, a split of four or more parts) and that every
  value must come from a tool result.
- **Starters**: add `checks` ("Does anything look off this month?"),
  `upcoming` ("What is still due this month?"), `review` ("Give me a month-end
  review") and `afford` to `assistant.suggestions` in the three locales, shown
  only when the member can read the dataset behind them.
- The assistant stays read-only. Nothing here lets it record or change data.

### Telegram daily report

`dailyFinanceReport.ts` gains an optional `moneyChecks` input and a short
"Worth checking" block listing only checks whose `date` is the reported
business date (duplicate expenses that day, a low-income day), at most three
lines, in both the text and the image renderers. No checks means no block. The
sending path loads what the checks need alongside its existing reads; if that
load fails the report is sent without the block.

## Data model

No migration. Everything is computed from existing rows.

## Tests

- Unit tests beside each new module: every detector at, below and above its
  threshold; an empty month; the first day of a month; a club with under four
  weeks of history; archived presets; a past month.
- `datasets.test.ts`, `tools.test.ts`, the `AssistantMarkdown` link and chart
  rules, the Telegram text and image renderers.
- `e2e/`: the Financial Analysis spec asserts the new section renders; no route
  or sign-in flow changes.

## Slices

1. **Money checks: calculation and Financial Analysis panel.**
   `moneyChecks.ts` + tests, the loads it needs, `MoneyChecksPanel`, skeletons,
   `cashShortagesHref`, copy in three locales, e2e assertion.
2. **Still due and plan suggestions.** `upcomingPayments.ts` + tests, the
   `ExpensePlanPanel` changes, prefilled create-plan form, skeletons, copy.
3. **Assistant: `checks` and `upcoming` datasets, record links, starters.**
   Datasets, `links` on tool results, prompt changes, safe internal links in
   `AssistantMarkdown`, the `checks`/`upcoming`/`review` starters.
4. **Assistant: charts in answers.** The `chart` block, its validation and
   renderer, prompt guidance, tests.
5. **Assistant: outlook and affordability.** The `outlook` dataset, prompt
   guidance for "can we afford", the `afford` starter.
6. **Telegram: "Worth checking" block.** Text and image renderers, the sending
   path's load, tests. Read `docs/runbooks/telegram-report.md` first.

Each slice leaves `main` working and is useful without the ones after it.

## Risks and open questions

- **Noise.** A check list that cries wolf gets ignored. The thresholds above
  are deliberately conservative; they are constants so they can be tuned from
  real months after shipping.
- **Load on Financial Analysis.** Three extra months of expenses per visit. If
  the existing snapshot RPC cannot widen its range cheaply, fetch the history
  once per month selection and keep it out of the first paint (the panel has
  its own skeleton).
- **Prompt cache.** The system prompt is cached; changes to it are made once
  per slice, not per request.
- **Model-written links and charts** are rendered from model output, so both
  are validated in the renderer, not trusted from the prompt.
- **Telegram image layout** is hand-measured; the new block must not push the
  image past its current height limit. Slice 6 goes last for that reason.
