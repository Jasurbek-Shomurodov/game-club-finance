# PresentationFoundation

The single home for reusable presentational components. Pages under
`src/app` compose these; they should not hand-write button, input, card,
alert, modal, badge or table markup.

Import from the barrel:

```tsx
import { Button, Card, Field, Input, InlineAlert, PageHeader } from '@/components/PresentationFoundation';
```

| Need | Use |
|---|---|
| Page title, tabs, actions, back link | `PageHeader` |
| White panel / section | `Card` (+ `SectionHeading`, `CardHeader`, `CardBody`, `CardFooter`) |
| Any clickable action | `Button` (`variant`: primary, outline, secondary, ghost, danger, dangerOutline, success), `ButtonLink` for navigation (`download`, or `target="_blank"`, makes it a plain link out of the app), `IconButton` for icon-only (`variant`: outline, ghost, soft, danger, primary, success; `size`: sm, md, `lg` = 44 px beside a `Button`) |
| More actions than fit in a row | `ActionMenu` (`label`, `items`: `{ label, icon?, onSelect, disabled?, tone?: 'danger' }`): the three-dots button and its menu |
| Text / money / select / textarea | `Field` + `Input` / `CurrencyInput` / `DecimalInput` / `Select` / `Textarea` / `Checkbox` |
| Required note on a spending entry (5+ words) | `useEntryNoteGuard` + `NoteField`; call `guard.check(note)` before saving and render `guard.dialog` |
| Multi-select option tiles (payment methods, page access) | `Checkbox variant="card"` |
| Where an expense went, at the start of its row | `CategoryIcon` (`category`, or `kind` for income / debt payments / exchanges; `tone="bar"` when bar money paid). Every list of expenses starts its rows with one |
| Person or product initials | `Avatar` (`tone`: primary for people, neutral for products) |
| Search box | `SearchInput` |
| Mutually exclusive choice (payment method, tabs, filters) | `SegmentedControl` (`variant`: solid, soft, chips; `size="lg"` for a big payment-method picker) |
| Whole-number quantity | `Stepper` |
| Dates and months | `DatePicker`, `DateRangePicker`, `MonthPicker` |
| Save results, errors, notes | `InlineAlert` (inline; `size="sm"` inside a form row) or `useToast` (transient) |
| Status or kind chip | `Badge` (`variant`; `size`: sm, md, lg) |
| A load failed | `LoadErrorAlert` (danger alert with the shared Retry button); pair it with `useClubQuery` from `src/lib` |
| Destructive confirmation | `useConfirm` / `ConfirmDialog` (never `window.confirm`) |
| Dialogs | `Modal` (`padding="none"` for an edge-to-edge list or table), `Drawer` (animated side panel) |
| The facts of one record in a details sheet | `DetailHero` (`title`, `subtitle`, `amount`, `amountLabel`, `tone`, `badge`) over `DetailList` (`items`: `{ label, value }`; `stack` puts long values under their labels on phones) |
| Collapsible help or secondary list | `Disclosure` (native `<details>` with a chevron summary) |
| "What is this?" beside a heading | `HelpButton` (a `?` that opens a `Modal`; blank lines in `body` start paragraphs) |
| KPI numbers | `MetricCard` (formatted value), `AmountCard` (money with comparison and an optional `sparkline`), `StatTile` (compact). Pass `href` (the records behind the figure, built with `@/lib/detailLinks`) or `onClick` (a details sheet) to make one tappable; leave both out for a plain figure |
| A whole panel that opens something | `Card` with `href` or `onClick` (one tap target with the shared lift, press and focus ring; `chevron={false}` when the content already shows where it leads). `TappableSurface` is the shell underneath, for a tappable thing that is not a card (`fit` for content width; `expanded` + `controls` when it shows or hides something in place). `Card tone` also takes `danger` |
| What a card, row or section is about | `IconChip` (`icon`, `tone`, `size`): the icon on a tinted tile. `MetricCard`/`AmountCard` draw theirs from `icon`, toned by the figure's `tone` or an explicit `accent` (`bar`, `reserve`, …) |
| A colour that means something | A `Tone` from `tone.ts` (`neutral`, `primary`, `success`, `danger`, `warning`, `bar`, `reserve`) and its `toneClasses[tone]` (`text`, `chip`, `surface`, `solid`, `hover`) |
| Tiny trend line | `Sparkline` (shape only, takes the text colour; pass at least two values) |
| At-a-glance charts | `src/components/charts`: `DonutBreakdown` (ranked donut, each slice named with amount and share), `RadialMeter` (ring around a printed figure), `CalendarHeatmap` (month shaded by day), `WeekdayBars`, `DailyInOutChart`, `ShareBar` (`legend={false}` when the parts are named beside it). A `ChartTooltipBody` series with `format` prints that row itself (a percentage) instead of as money. Category hues come from `categoricalColors` in `dashboard/ChartCard` in fixed order; the figures from `src/lib/calculations/insights.ts`. One business per chart: never add the game club and the bar together |
| Tables | `DataTable` (supports totals row, sticky header, empty state; pass `label` so keyboard users can scroll wide tables; pass `mobileCards` so phones get one card per row instead of a sideways scroll; `busy` dims it during a refetch; `sticky: true` on the first column pins it while the table scrolls sideways) |
| Nothing to show | `EmptyState` (`as` sets the title's heading level; `tone="warning"` tints the icon tile) |
| Loading | `Skeleton`, `SkeletonCard` from `charts/ChartSkeletons` (`padding`: sm, md, like `Card`), `MetricGridSkeleton`, `TableSkeleton`, `FormSkeleton`, `DetailListSkeleton`, `EmployeeCardGridSkeleton`, `ChartSkeleton`, `PageSkeleton` |
| Loading in a page's own shape | A `<Page>Skeleton.tsx` beside the page (dashboard, reports, financial analysis, reserve, owner profit), used by its `loading.tsx`, its Suspense fallback and in-page loading, wrapped in `SkeletonStatus` for the "Loading…" announcement. A new card or chart exports its own `<Name>Skeleton` (`SideGlanceCardSkeleton`, `SideScorecardSkeleton`). Update the skeleton whenever the layout changes |

Design rules ("quiet surfaces, loud numbers"):

- One accent (`primary-*`) for actions and the current nav item. Colour is
  reserved for meaning: `success` money in / profit, `danger` money out /
  debts, `warning` needs attention. Never tint a section just to label it;
  `Card tone` is deliberately faint and should be rare.
- Numbers are the loudest thing on a page: `MetricCard`/`AmountCard`/
  `StatTile` set them bold with tight tracking and the currency as a small
  muted suffix on the same line. The icon sits on a small tile toned by what
  the figure means (grey when it means nothing). Don't add a sentence of
  explanation under every number; use one subtitle per section or a `title=`
  tooltip.
- `PageHeader` no longer draws an icon tile or a subtitle, so every page opens
  the same way: title, then actions on the right (they wrap on phones). Inside
  the dashboard shell (`TopBarSlotProvider`) the title renders in the top bar,
  and `tabs` (a `SegmentedControl` with `variant="tabs"`, right after the
  title) and the actions join it on wide screens while they fit on the bar's one line;
  meta sits beside the title and the back link stays on the page. Keep header
  actions to one row of compact controls so they can move up.
- Disabled `Button`s are plainly grey; secondary actions are `outline` or
  `ghost`, never a primary that happens to be disabled.
- The currency label is always `tc('currency')` (сум / so'm / UZS), never a
  hardcoded "UZS".

Phones:

- A table a person reads row by row takes `mobileCards`: below `sm` each row is
  a card with the first column as its title, the other columns as labelled
  values two to a line, and the `actions` column in the corner. Tune a column
  with `mobile: 'title' | 'full' | 'action' | 'hidden'`. A hand-built table gets
  the same layout from the `.stack-table` class with `data-label` /
  `data-stack` on its cells (closing stock). Keep the wide scrolling table only
  for a grid that is compared across rows (the monthly report).
- A row of `MetricCard`s uses `metricGridClassName` (two to a line on phones,
  an odd last card full width) plus its own `sm:`/`lg:` column counts.
- Page tabs are 40 px tall on phones; keep any new tap target at least 36 px.

Rules of thumb:

- Components take already formatted strings for money and dates; format with
  `src/lib/formatters.ts` at the call site.
- Every icon-only control needs a `label`; every field needs a `label` or an
  `aria-label`.
- Use the `danger` / `success` / `primary` / `warning` colour tokens rather
  than raw Tailwind reds and greens so the palette stays consistent.
- Money and prices: `Money` shows the translated currency (сум / so'm / UZS)
  by default; `CurrencyInput` keeps the caret in place while separators move
  and ignores a pasted decimal part ("1 500,50" → 1 500). `DecimalInput` is for
  values that are not whole UZS (dollars, exchange rates): two decimals, `.` or
  `,`, parsed with `parseDecimalInput`.
- Dialogs stack: `Modal`, `Drawer`, `ConfirmDialog`, the date/month pickers and the
  mobile drawer register with one modal stack, so Escape and the Tab focus trap
  only act on the top dialog. A bespoke overlay must use `useModalLayer` +
  `trapFocus` from `./Modal` to join it.
- Overlays animate through `./motion`: `usePresence` keeps an overlay mounted
  while it plays its exit, and `backdropMotion`/`sheetMotion`/`slideMotion`
  give the shared fade, bottom-sheet/scale and side-slide transitions (skipped
  for reduced motion). `Modal` holds its last open content while closing, so
  callers may clear the state that fed it as soon as it closes.
- Menus and popovers open through `popoverMotion` (fade and grow from the control) on the picker layer (`z-[80]`, above `Modal`), and register with the modal stack like `ActionMenu` does.
- `SegmentedControl` is a radio group: one Tab stop, arrow keys move and select.
  In the `soft` and `tabs` variants one shared pill/underline glides to the
  selected option.
- Toasts appear at the top on phones (never over a bottom sheet's Save button)
  and bottom-right on larger screens; errors stay 8 s and pause on hover/focus.
  They slide in and out, and a thin countdown bar is their timer.
- Every `<details>` (including `Disclosure`) grows open and folds shut where
  the browser supports `interpolate-size` (globals.css).
- Rows added or removed in place grow in or fold away so the list closes up:
  `DataTable` does this itself; for a hand-built list use `useListPresence`
  and render each entry with `PresenceItem`. Up to three changes at once
  animate; a bigger change (another month, a filter) is shown at once.

Motion (globals.css, "Motion system"; all of it is skipped under reduced motion):

- Pages arrive on their own: the shell's `.page-enter` staggers each page's
  top-level sections, and whatever replaces a skeleton rises in the same way.
  Mark a grid or list `stagger` to cascade its items; mark a meter's fill
  `grow-x` so it fills from its start edge.
- `Skeleton` is a shimmer sweep, not a pulse. Keep using `Skeleton` and the
  page-shaped `<Page>Skeleton`; never write `animate-pulse`.
- Tappable surfaces get `.tappable` (hover lift, press dip) from `Card`,
  `MetricCard`, `AmountCard`, `StatTile` and `TappableSurface`. A hand-built
  row button may add the class itself.
- These animations fill backwards only, so nothing keeps a transform after it
  has played (sticky headers and fixed children are safe). Do not animate with
  `forwards`/`both` on a container.

## Shared states added in the November 2026 audit

- `selected` on `MetricCard`, `StatTile`, `Card` and `TappableSurface`: the one ring for "this filter is on" (also sets `aria-pressed`). Do not paint a ring through `className`.
- `TableSkeleton bare`: the placeholder for a `DataTable bare` inside a card.
- `Textarea` grows with its text (up to `max-h-72`); do not use a single-line `Input` for free text.
- Programmatic scrolling uses `scrollBehavior()` from `@/lib/scroll`, so it respects reduced motion.
- Negative amounts from `formatNumber`/`formatCurrency` carry a real minus sign (U+2212).

