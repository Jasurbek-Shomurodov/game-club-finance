# Reserve charts you can select and explore

## Goal and user flow

The reserve overview (`/reserve`) has three charts that only react to a mouse
hover: nothing can be selected, the period cannot be changed, "Money in and
out" is two months of bars in a wide empty card, and tapping a donut category
opens every purchase instead of that category. On a phone the owner cannot ask
the charts anything.

After this change:

1. **Pick a period.** A "Over time" section heading carries one period control
   (30 days, 90 days, 1 year, All). It governs every chart below it.
2. **One chart for balance and movement.** "Reserve over time" becomes a
   single card: the balance (step area) on top and, under it on the same time
   axis, what was put in and taken out in each bucket (paired bars). It
   replaces both the old balance chart and the separate "Money in and out"
   card.
3. **Select a point.** Tapping (or dragging across) either plot selects that
   day/week/month. The selection stays after the finger lifts: a marker line
   in both plots, the bar pair highlighted, and a readout above the chart with
   the date (or date range), held at its end, put in, taken out, plus
   previous/next arrows to step and a clear button. With nothing selected the
   readout shows the period: held now and the change over the period.
4. **Open what is behind it.** The readout has "Show N entries", which opens
   the History view filtered to the selected dates. History shows that filter
   as a dismissible chip next to the kind filter.
5. **Donut follows the period, and a category opens that category.** "What the
   reserve paid for" counts purchases in the chosen period; tapping Rent opens
   History filtered to purchases of rent in that period.

## Placement

- Area: Owner money → `/reserve`, Overview view, the glance section
  (system-design section 3). No new page, no new links from other pages.
- The top part of the page (pots, buy/sell, the three totals, the split bar)
  is unchanged and stays all-time.
- Layout of the glance section: section heading row (label left, period
  `SegmentedControl` right, wraps on a phone), then a grid `xl:grid-cols-3`:
  the over-time card `xl:col-span-2`, the donut card `xl:col-span-1` (legend
  under the ring at every width inside that narrow card; add a `rowFrom`
  option to `DonutBreakdown` if needed rather than overriding its classes).

## Architecture

No route, API, RPC or migration changes. No new data is fetched.

### Pure calculations: new file `src/lib/calculations/reserveExplorer.ts`

Do **not** add these to `ownerReserve.ts`: that file has uncommitted work from
another feature (`docs/plans/reserve-from-reports.md`) which must stay
untouched and uncommitted. Import `reserveActivity`/`ReserveActivity` from it.

- `type ReservePeriod = '30d' | '90d' | '1y' | 'all'`
- `reservePeriodStart(period, throughDate): string | null` — the first ISO day
  of the window (inclusive, so 30d is 30 days ending on `throughDate`); `null`
  for `all`. ISO-string day arithmetic only (as `nextIsoDay` does); `throughDate`
  is the club's business today passed in by the page. No `new Date()` "now".
- `type ReserveBucketUnit = 'day' | 'week' | 'month'` and
  `reserveBucketUnit(firstDay, lastDay)`: day when the span is ≤ 92 days, week
  (Monday start) when ≤ 370 days, else month. So 30d/90d are daily, 1y weekly,
  All depends on how old the reserve is.
- `interface ReserveBucket { key: string; from: string; to: string; held: number; deposited: number; withdrawn: number; count: number }`
  — `key` is `from`; `to` is clamped to `throughDate`; `held` is what the
  reserve holds at the end of `to` (same rule as `reserveDailySeries`: one pot,
  exchanges change nothing, never below zero, activity dated after
  `throughDate` counted on `throughDate`); `deposited` = deposits, `withdrawn`
  = returns + purchases; `count` = activity rows in the bucket **including**
  exchanges (it is the number the "Show N entries" button promises, so it must
  equal what the history date filter then lists).
- `reserveExplorerSeries(activity, throughDate, period): { unit, buckets, openingHeld }`
  — window starts at the later of the period start and the first activity day;
  `openingHeld` is the balance before the window (0 when the window starts at
  the first activity). Empty activity → no buckets. Buckets are continuous
  (empty ones filled in).
- `reserveActivityInRange(activity, from, to, throughDate)` — the rows the
  history shows for a date filter, using the same "after today counts as
  today" rule, so the count and the list cannot disagree.
- Spending for the donut in a period: filter with `reserveActivityInRange`
  then reuse `reserveSpendingByCategory`.

Totals over the window must reconcile:
`openingHeld + Σdeposited − Σwithdrawn` equals the last bucket's `held`
whenever the running balance never went negative. Test it.

### Chart component: `src/components/charts/BalanceFlowChart.tsx`

Presentational, no data access, reusable (the money pages can adopt it later).

Props: `rows: { key; label; tooltipLabel; held; income; expenses }[]`,
`selectedKey: string | null`, `onSelect(key | null)`, labels for the three
series, `legendLabel`, `currency`, `locale`, heights.

- Two recharts charts sharing `syncId` and the same `rows`: an `AreaChart`
  (`type="stepAfter"`, zero baseline, the existing gradient) about 200px, and a
  `BarChart` about 96px with the x axis only on the lower one. Same left
  gutter (`CHART_Y_AXIS_WIDTH`) on both so the plots line up.
- Selection: chart-level `onClick` (uses `activeLabel`/`activeTooltipIndex`,
  so a tap anywhere in the column selects, not only on the thin bar or the
  line); tapping the selected column again clears. Selected column:
  `ReferenceLine` in both plots, `ReferenceDot` on the balance, other bars
  dimmed with `Cell` opacity. Days with movement get a small dot on the
  balance line so the owner sees where to tap.
- Tooltip stays for hover (`ChartTooltipBody`), series from `chartColors`
  (primary, success, danger). Legend via `ChartLegendToggle` for put in /
  taken out as `DailyInOutChart` does.
- Keyboard: the plot wrapper is focusable; Left/Right move the selection,
  Escape clears. `role="group"` with an `aria-label` summarising the period.
- Export `BalanceFlowChartSkeleton` from `ChartSkeletons.tsx` with the same
  footprint (readout line, tall plot, short plot).
- Use only the motion/colour system; no new keyframes or palette.

### Page: `ReservePage.tsx` and a new `ReserveExplorer.tsx` beside it

- `ReserveExplorer.tsx` (route-local, lazy like the charts today) owns the
  readout and renders `BalanceFlowChart`. Readout is built from
  `PresentationFoundation` (`StatTile`s or the existing text styles,
  `IconButton` for previous/next/clear, `Button` for "Show N entries").
  Money through `formatCurrency`, dates through `formatDateOnly` /
  `formatDateShort` / `formatMonthShort`; a week reads "3 – 9 November".
  The change over the period is signed and toned (success/danger).
- State in `ReservePage`: `period` (default `90d`), `selectedKey` (reset when
  the period, club or data changes), and the history filter grows from a kind
  to `{ kind, from?, to?, category? }`. Kind filter options and "filter empty"
  state keep working with the date filter applied; the date/category chip has
  a clear button and reads e.g. "3 – 9 November · Rent".
- Remove the now-unused `ReserveBalanceChart` (`ReserveCharts.tsx`), the
  monthly `flowSeries` and the `DailyInOutChart` import from this page
  (`DailyInOutChart` itself stays; other pages use it). Remove
  `reserveMonthlySeries` only if nothing else uses it — check first; if the
  page was its only caller leave the function and its tests in place.
- Top tiles (Put in / Returned / Paid) keep opening all-time history by kind.

## Data model

None. No migration.

## Design rules

- Components from `PresentationFoundation`; charts from `src/components/charts`
  and `dashboard/ChartCard`. No hand-written `<button>` around cards.
- Tappable: every bucket selects; the readout button opens the records;
  donut rows and slices open their category. Targets ≥ 44px for the arrows
  and the chip's clear button.
- Phone first (360px): period control wraps under the heading and fits
  without horizontal scroll (short labels: "30 d", "90 d", "1 y", "All" in
  each language); readout wraps to two lines; x ticks thin out with
  `minTickGap`.
- Skeletons: update `ReserveOverviewSkeleton` to the new shape (heading +
  control, 2/3 chart card with readout and two plots, 1/3 donut card; no third
  card). `loading.tsx` uses it already.
- Locales: add keys under `reservePage` in `en.json`, `ru.json`, `uz.json`
  with identical shapes; delete keys that are no longer used (the old
  flow title/description) in all three.

## Tests

- `src/lib/calculations/reserveExplorer.test.ts`: period starts; unit choice
  at the boundaries; daily/weekly/monthly buckets with gaps; opening balance
  carried into a window; exchanges count as entries but move nothing; activity
  dated after today lands on today; the never-below-zero rule; reconciliation;
  `reserveActivityInRange` matches bucket `count`; week boundaries across a
  year end.
- `src/components/charts/charts.test.tsx`: `BalanceFlowChart` renders, a
  selected key shows the marker, keyboard Left/Right/Escape call `onSelect`.
- `e2e/`: check `e2e/p0.spec.mjs` for reserve assertions that name the removed
  "Money in and out" card or the old headings and update them in the same
  change.
- Gate: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Slices

1. **Everything above, as one change.** The calculation file and tests, the
   chart component and skeleton, the explorer card with period and selection,
   the history date/category filter, the donut following the period, the
   three locales, the page skeleton, e2e updates. It leaves `main` working and
   is not useful in smaller pieces (a selectable chart with nothing to open is
   the problem being fixed).

## Risks and open questions

- **Uncommitted work in the tree** (`ownerReserve.ts`, its test,
  `src/components/owner-reserve/`, `docs/plans/reserve-from-reports.md`)
  belongs to another feature. Do not edit, format, stage or revert it.
- recharts 2 `syncId` syncs hover, not our selection; selection is our own
  state passed to both plots, so it does not depend on it.
- On touch, recharts fires the tooltip on touch-move and `onClick` on tap;
  verify a tap selects on a phone-sized viewport, not only with a mouse.
- A reserve younger than the chosen period simply shows from its first day;
  period options are never hidden, so the control does not jump around.
