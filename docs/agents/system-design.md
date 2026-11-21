# System design: where things go

Read this before adding a feature, a page, a card or a chart. The app became
cluttered once because each new feature was attached to whichever page was open
at the time. This guide is the rule for placing things, so the next feature has
one obvious home.

`architecture.md` explains how the app runs. This file explains how the product
is organised and how its parts are meant to look and behave.

## 1. Product map

Every screen belongs to one area. An area answers one question for one moment
of the owner's day.

| Area | Question it answers | Screens | Sidebar item |
|---|---|---|---|
| Overview | How is the club doing? | `/dashboard`, `/financial-analysis`, `/assistant` | Dashboard, Financial Analysis, AI Assistant |
| Every day | What do I record today? | `/daily-cash` | Daily cash |
| Bar | What is in stock, what moved, what went missing? | `/closing-stock`, `/write-offs`, `/stock-purchase`, `/products`, `/promotions` | Bar (tabs) |
| Money | Where is the money and who holds it? | `/reports` (closeout, collected, write-offs), `/daily-report`, `/monthly-report`, `/debts` | Reports, Debts |
| Owner | What can I take, what have I set aside? | `/money-taken`, `/reserve` | Owner Profit (tabs) |
| People | Who is owed what? | `/salaries/*` | Salaries |
| Manage | Who can do what, what does the public see? | `/showcase/*`, `/team`, `/history`, `/settings` | Public page, Team |

Drill-down pages (`/game-club-money-details`, `/bar-money-details`) have no nav
item on purpose: they are only reached by tapping a figure.

`/test-checklist` is an owner-only data check with no nav item; it is opened
from the command palette. `/expense`, `/expenses`, `/balance` (to `/reports`)
and `/income` (to `/daily-cash`) are redirects kept for old bookmarks; they are
not screens and get no links.

Sections with several screens share one sidebar item and switch with tabs
beside the page title (`src/lib/navigation.ts`, `SECTION_TABS`). Add a screen to
a section there; do not add a sidebar item for it.

## 2. Placing a new feature

Ask these in order and stop at the first yes.

1. **Is it a new fact about something that already has a page?** Put it on
   that page, in the section that already holds its siblings. A new figure
   joins the existing metric row; it does not get a new card above everything.
2. **Is it a way to record something?** It belongs where that thing is
   recorded today (Daily cash, the Bar tabs, the Reports header actions,
   Salaries → Daily operations). A recording form may be *launched* from other
   pages (a button that opens the same modal), but there is one form component.
3. **Is it a list of records over time (a ledger)?** It is a tab of its area,
   not a card on a summary page. Summary pages link to it.
4. **Is it a summary across areas?** It goes on the Dashboard only if the owner
   needs it every day and it fits the headline row; otherwise Financial
   Analysis.
5. **None of the above?** It is a new screen in the area whose question it
   answers. Add it to `SECTION_TABS`, `permissions.ts`, `commands.ts` and `e2e/`
   together.

One source per figure. A number is computed in exactly one function in
`src/lib/calculations` and may be *shown* in several places, but the second
place links to the first (see section 4) instead of rebuilding the breakdown.

Each money or stock concept has a single home. Other pages show at most a
one-line balance that links there:

| Concept | Home | Other pages may show |
|---|---|---|
| Owner reserve | `/reserve` | the balance, as a link |
| Bar write-offs and corrections | `/write-offs` (today's form + month ledger) | Reports tab (same ledger for any range), Owner Profit (month loss, link) |
| Cash shortages | Owner Profit | a "record shortage" button |
| Expenses | Reports closeout | "add expense" button that opens the same form |
| Collected money | Reports → Collected | the three pots on the closeout |

## 3. Anatomy of a page

Every admin page is built top to bottom in the same order, so the eye learns it
once:

1. `PageHeader`: title, section tabs, the period picker, at most three actions.
2. **Headline row**: two to five `MetricCard`/`AmountCard` figures for the
   period. Each one is tappable (section 4).
3. **Glance**: charts that explain the headline (a trend, a split, a calendar).
   One business per chart; never add the game club and the bar together.
4. **Records**: the table or list, with its filters directly above it.
5. Dialogs and forms open over the page; they are not sections of it.

A page that needs more than this is two pages.

## 4. Everything is tappable

A person taps a figure to ask "what is this made of?" and a row to ask "show me
this one". Every card, tile, chart segment and row answers one of those.

| Tapped thing | Opens |
|---|---|
| A figure for a period | The records behind it: the ledger filtered to that period and kind (`src/lib/detailLinks.ts`) |
| A figure that is a filterable subset of the list on the same page | That list, filtered (the card shows a selected ring; tapping again clears) |
| A slice, bar or calendar day | The same ledger narrowed to that category or day |
| A row | A details sheet (`Modal`) with an "open the record" link to where it can be edited |
| A person or product | Their own page or the list filtered to them |

Rules:

- Build links with `src/lib/detailLinks.ts`; a target page reads the same query
  parameters. Add a helper there before hand-writing a query string.
- Use `MetricCard`/`AmountCard`/`StatTile`/`Card` with `href` or `onClick`;
  they render a real link or button with the shared lift, press and focus ring
  (`TappableSurface`). Never wrap a card in a hand-written `<button>` and never
  put `onClick` on a `div`.
- A figure with nothing behind it (a ratio, a day count) stays plain. Do not
  fake a destination.

## 5. Design language

The foundation lives in `src/components/PresentationFoundation` (see its
README for the component table). The rules that make pages look like one app:

- **Quiet surfaces, loud numbers.** Cards are plain; the figure is the loudest
  thing. Colour means something or it is not used.
- **One tone vocabulary** (`tone.ts`): `neutral`, `primary` (the app and the
  game club), `success` (money in, profit), `danger` (money out, loss),
  `warning` (needs attention), `bar` (orange), `reserve` (purple). Icon tiles
  (`IconChip`), tappable surfaces and meters all take a tone from it. Do not
  type `text-danger-600` for a new meaning; pick the tone.
- **Icons say what a thing is.** A metric card, a section and a ledger row
  start with an icon on a tinted tile: `IconChip` for concepts, `CategoryIcon`
  for expense categories, `Avatar` for people and products.
- **Motion has three jobs** (globals.css, "Motion system"), all skipped under
  reduced motion:
  - *arrive*: `.page-enter` staggers a page's sections in reading order with no
    opt-in; `.stagger` does the same for a grid or list; `.grow-x` fills a meter.
  - *load*: `Skeleton` shimmers; every page has a placeholder in its own shape.
  - *respond*: `.tappable` lifts on hover and dips on press; figures roll to a
    new value (`RollingText`); rows fold in and out (`useListPresence`);
    overlays slide through `motion.ts`.
  Do not add a one-off keyframe to a page. If a new movement is needed, add it
  to the motion system and name it.
- **Charts** come from `src/components/charts` and `dashboard/ChartCard`
  (`chartColors`, `categoricalColors`, `ChartTooltipBody`, `ChartLegendToggle`).
  A new chart uses those; it does not bring its own palette, tooltip or legend.

## 6. Layers

```
page (src/app/(dashboard)/<route>/<Name>Page.tsx)   coordinates: query, state, layout
  ├─ feature components (beside the page, or src/components/<feature>)
  ├─ PresentationFoundation + charts                presentational only, no data access
  ├─ src/lib/supabase/*                             queries and RPC calls, club-scoped
  └─ src/lib/calculations/*                         pure formulas, unit-tested
database (migrations/)                              RLS, constraints, atomic RPCs
```

- A component shared by two routes moves to `src/components/<feature>/`
  (`stock-adjustments`, `money-details`, `cash-shortages`, `expenses`,
  `reports`, `owner-money`). A component used by
  one page stays beside it.
- A page file over roughly 600 lines is carrying feature components that should
  be split out beside it. `ReportsPage.tsx` and `MoneyTakenPage.tsx` are the
  known offenders; split them when next changing their structure, section by
  section, without changing behaviour in the same commit.
- Totals that must be right are computed in `src/lib/calculations` from rows
  the database returned, or by an RPC. They are never re-derived inline in JSX.

## 7. Checklist for a change that adds UI

- [ ] It sits where section 2 says, and the page still follows section 3.
- [ ] Every new figure, row and chart segment is tappable or deliberately plain.
- [ ] The page's skeleton (`<Page>Skeleton.tsx`, `loading.tsx`, in-page loading)
      has the new shape.
- [ ] Copy is in `en.json`, `ru.json`, `uz.json` with matching shapes.
- [ ] Money, dates and percentages go through `src/lib/formatters.ts`.
- [ ] No new colour classes for meaning, no new keyframes, no hand-built card.
- [ ] The formula is in `src/lib/calculations` with a test.

## 8. Known debts

Recorded so they are chosen deliberately instead of rediscovered:

- **Stock adjustments are columns, not rows.** A write-off or correction lives
  on the day's `daily_stock_counts` row (`adjustment_quantity`,
  `adjustment_reason` with the kind as a text prefix). So a product can carry
  only one adjustment per day, the kind is parsed from text, and reducing or
  removing one leaves no history (`record_entry_audit` is not attached to stock
  counts). A dedicated `stock_adjustments` ledger would fix all three; it
  changes `save_closing_stock_counts` and the bar profit functions, so it is a
  project of its own.
- **Salary balances exist only in the browser.** `calculateSalaries` derives
  what each person is owed from every entry ever recorded, and the
  overpayment cap is enforced only in the form. The database cannot answer
  "what is owed to X" and does not stop an overpayment sent another way.
- **Large page files**, as listed in section 6.
- `assistant_model_usage` and `record_assistant_model_request` have no caller
  in `src`; confirm no rows are being written before dropping them.
