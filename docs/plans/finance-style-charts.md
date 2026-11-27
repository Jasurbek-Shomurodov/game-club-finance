# Charts that behave like the finance app

## Goal

The user's own finance app (`~/Desktop/finance-app`, same stack: Next.js +
Recharts 3) is the reference. Its charts feel like a trading or banking app.
This plan brings the same behaviour to this app's time charts, adapted to one
club owner on a phone, uz/ru/en, UZS and the business date.

What the finance app does (read these files there before building; copy the
behaviour, not the code style):

| Behaviour | Finance app source |
|---|---|
| Headline over the chart: big figure (rolling digits), then the change in the chosen period as `+amount · +%` with a trend arrow, green/red | `components/portfolio-overview.tsx` (`overview-hero-*`) |
| Period chips in the card header (30 days, 90 days, 1 year, All) | `portfolio-overview.tsx` `Segmented` |
| Full-screen button: the card fills the window and comes back; period, hidden lines and open day survive | `useFullscreenCard` |
| In full screen the chart pans and zooms through time like a trading chart: drag/swipe moves, wheel/trackpad/two-finger pinch zooms around the pointer, double-click shows all, zoom-in/zoom-out/show-all buttons with a hint line; a drag never opens a day; choosing a period zooms to it | `hooks/use-chart-viewport.ts`, `lib/chart-viewport.ts`, `components/investment-value-chart.tsx` |
| Value axis fitted to what is shown (floor follows the lowest value in view), ticks that never read the same | `lib/chart-scale.ts` (`niceAxis`, `flooredAxis`, `evenTimeTicks`), `distinctMoneyTick` |
| End labels: each line's latest value as a pill in the line's colour on a right-hand axis, spread so close lines stay readable | `presentation-foundation/chart.tsx` (`EndLabelTick`, `chartEndAxis`), `spreadLabels` |
| Lead series is an area with a fading gradient; comparisons are thin lines; planned/projected is dashed | `chart.tsx` (`leadArea`, `ChartGradient`, `plannedLine`) |
| On a phone a tap on the chart opens that day's details window; no tooltip is drawn under the finger (the cursor line still marks the day). On desktop the tooltip stays | `investment-value-chart.tsx` (`tapOpensDetails`, `noTooltip`) |
| One shared look module every chart spreads (`chartGrid`, `chartAxis`, `chartBar`, `chartLine`…) | `presentation-foundation/chart.tsx` |
| Sankey: tap a node or a flow to open its own Sankey in a dialog, Back returns, the records listed under it; flows coloured by direction of money | `components/cash-flow-sankey.tsx`, `sankeyFlowTone` |

This app already has: legend pills that hide/spotlight a series
(`ChartLegendToggle`), shared colours and tooltip (`dashboard/ChartCard.tsx`),
the Sankey drill dialog with a Back trail (`SankeyDrillModal`), the reserve
explorer (drag/pin/readout, keep as is), `RollingText`, `SegmentedControl`,
`Modal`/`Drawer`.

## Placement

No new pages or links. Changes live inside existing chart cards:

- Dashboard: `IncomeTrendChart`, `DailySalesLineChart`. The dashboard's own
  date range is the period (no chips here; the page already has a range
  picker).
- Financial analysis: `AnalysisTimeCharts`, `OverallCharts` time charts,
  `SankeyFlowChart`. The page's own month / overall period governs; the
  full-screen view may pan within the data the page already loaded.
- Shared bars: `DailyInOutChart` (salaries, money taken, reports).
- Reserve page: unchanged (it already has its own period chips and explorer);
  only picks up the shared look and the full-screen button if cheap.
- Out of scope: `AssistantChart`, donuts (already show the hovered slice in
  the centre and open on tap).

## Architecture

No routes, API, RPC, migrations or new fetches.

Shared, new, presentational (`src/components/charts`):

- `chartLook.ts`: the shared spreadable props (grid, axes, bars, lines,
  lead area, end axis) on top of the existing `chartColors`. Charts move to
  these instead of inline props.
- `ChartHeadline`: title, big figure with `RollingText`, change line
  (`+amount · +%`, trend icon, tone from `metricToneClassName`), optional
  caption. What the figure is (period total, or the latest value for a
  running/cumulative series) is chosen by the caller.
- `useChartViewport` + `src/lib/chartViewport.ts` (pure, tested): port of the
  finance app's pan/zoom over a time extent, `consumeDrag` so a drag never
  opens a day, `touch-action: none` only while navigable.
- `useFullscreenCard`: the card fills the viewport (fixed, over the shell,
  Escape and the button exit, body scroll locked), returns `chartHeight`.
- `EndLabels`: `EndLabelTick` + `spreadLabels` (pure, tested in
  `src/lib/chartScale.ts` with `niceAxis`/`flooredAxis`/`evenTimeTicks`).
- `ChartDayDetails`: a `Drawer`/`Modal` that lists the tapped day's series
  values (formatted UZS, side icons, never summing game club and bar) and an
  "Open day report" button when the chart has `onSelectDay`.
- `useIsMobile()` (coarse pointer or < 640 px): drop the tooltip and open
  `ChartDayDetails` on tap.

Pure helpers for the headline go in `src/lib/calculations/chartHeadline.ts`
(`periodChange(first, last)`, `changePercent`), reusing `seriesTotal`; no new
financial formulas: figures are what the charts already receive.

Behaviour change to call out: today a tap on a dashboard bar navigates to the
day report straight away. On a phone it will open the day's details sheet
first, with "Open day report" in it (as the finance app does). On desktop a
click keeps opening the report directly.

## Design rules

PresentationFoundation only (`Button`, `IconButton`, `SegmentedControl`,
`Drawer`/`Modal`, `RollingText`). Colours from `chartColors`/tones. Tap
targets ≥ 40 px. Motion from the system; nothing animates under
`prefers-reduced-motion`. Skeletons gain the headline block where a chart
gains it. Copy in en/ru/uz together under `charts.*`: full screen / exit,
zoom in / zoom out / show all, "Drag to move through time, scroll to zoom",
change in period, open day report, day details title.

## Tests

Unit: `chartViewport` (clamp, pan, zoom, showsAll), `chartScale` (nice and
floored axis, even ticks, spread labels), `chartHeadline`, `ChartHeadline`
and `ChartDayDetails` render, `useChartViewport` drag-vs-click. Existing chart
tests keep passing. e2e: `e2e/p0.spec.mjs` steps that tap a dashboard bar.

## Slices

1. **Shared look and pieces.** `chartLook.ts`, `chartScale`, `chartViewport`
   + hook, `useFullscreenCard`, `EndLabels`, `ChartHeadline`,
   `ChartDayDetails`, `useIsMobile`, copy, tests. No chart uses them yet.
2. **Dashboard.** `IncomeTrendChart` and `DailySalesLineChart`: headline,
   end labels, tap-opens-details on phone, full screen with pan/zoom, the
   shared look; skeleton.
3. **Financial analysis time charts.** Same treatment for
   `AnalysisTimeCharts` and the time charts in `OverallCharts` (cumulative
   profit as a lead area with its latest value as the headline).
4. **Shared in/out bars.** `DailyInOutChart`: shared look, tap-opens-details
   on phone, full screen.
5. **Sankey.** Flows coloured by direction (income in, cost out, profit
   kept, loss), tap on a flow opens the node it leads to, as the finance app
   does; keep the existing drill dialog and Back trail.

Each slice ships on its own and leaves `main` working.

## Risks

- Full screen over the app shell on iOS Safari: use `100dvh`, lock body
  scroll, restore focus on exit.
- Pan/zoom must not steal vertical page scroll when not in full screen
  (only navigable in full screen, as in the finance app).
- Dashboard bars are daily within the page range; pan/zoom is limited to the
  loaded range.
