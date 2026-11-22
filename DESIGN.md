# DESIGN.md: Game Club Finance

The design system in one file, in the DESIGN.md layout coding agents already
know. It describes what exists; it does not replace the sources of truth:

- tokens: `src/app/globals.css`, `tailwind.config.ts`
- tone vocabulary: `src/components/PresentationFoundation/tone.ts`
- components: `src/components/PresentationFoundation/README.md`
- where things go, tappability, motion: `docs/agents/system-design.md`

If this file and a source disagree, the source wins; fix this file.

## 1. Visual theme and atmosphere

A finance tool an owner opens every morning. Calm, dense without being
cramped, and the same in three languages and two themes.

- **Quiet surfaces, loud numbers.** Cards are plain; the figure is the loudest
  thing on the screen.
- **Colour means something or it is not used.** Green is money in, red or
  salmon is money out, amber needs attention, orange is the bar, purple is the
  owner reserve, the accent is the app and the game club.
- **Two themes from one set of class names.** Light is a slate-tinted white
  with a blue accent. Dark is a green-tinted near-black with one teal accent.
  Components never branch on the theme.
- The public site (`src/app/(public)`, `src/components/showcase`) is a separate,
  always-dark marketing look with its own stylesheet. These rules are for the
  admin app.

## 2. Colour palette and roles

Tokens are RGB triplets (`--c-*`) used through Tailwind classes. Never write a
hex value, `white`, `black` or a raw Tailwind palette (`slate`, `emerald`).

| Role | Class family | Light | Dark |
|---|---|---|---|
| Page background | `bg-gray-50` | `247 248 250` | `16 20 18` |
| Card surface | `bg-surface` | `255 255 255` | `24 30 27` |
| Hairline border | `border-gray-200` | `227 231 238` | `48 59 51` |
| Body text | `text-gray-950` / `900` | `11 16 24` | `247 250 248` |
| Muted text (smallest allowed for text) | `text-gray-500` | `102 112 133` | `140 155 145` |
| Icons, placeholders only | `text-gray-400` | `152 162 179` | `104 119 109` |
| Accent (actions, game club) | `primary-600` | `47 82 224` | `92 200 185` |
| Text on a filled accent | `text-on-accent` | `255 255 255` | `5 46 42` |
| Money in, profit | `success-600` | `14 138 93` | `76 195 138` |
| Money out, loss, debt | `danger-600` | `199 55 49` | `240 160 150` |
| Needs attention | `warning-600` | `192 127 18` | `223 184 131` |
| The bar | `orange-600` | `217 100 26` | `242 168 120` |
| Owner reserve | `purple-600` | `106 72 224` | `176 159 250` |
| Auth brand panel | `bg-panel` / `text-on-panel` | `11 16 24` / white | same |

Rules:

- Pick a **tone**, not a colour: `neutral`, `primary`, `success`, `danger`,
  `warning`, `bar`, `reserve` (`tone.ts`). `IconChip tone`, `MetricCard accent`,
  `Card tone`, `Badge variant` take it.
- `text-gray-400` is for icons and placeholders. Text a person reads is
  `text-gray-500` or darker (4.5:1 in both themes).
- Charts use `chartColors` and `categoricalColors` from
  `src/components/dashboard/ChartCard.tsx`: five hues in a fixed order
  (`viz-1`..`viz-5`), the tail folds into grey "other". One business per chart.

## 3. Typography

- Family: **Onest** (Latin and Cyrillic), variable weight, `font-sans`.
- Scale: 12 (`text-xs`), 13 (card labels and small buttons only), 14, 16, 18,
  20, 24, 30, 36 px. **Nothing under 12px.**
- Money: `tabular-nums`, thousands separated by spaces (`1 000 000`), the unit
  (`сум` / `so'm` / `UZS` from `tc('currency')`) as a muted suffix after a real
  space. The number never wraps; only the gap before the unit may.
- Negative amounts carry a real minus sign (U+2212). Dollars print as
  `$546,92` through `formatDollars`.
- Everything goes through `src/lib/formatters.ts`. Never `toLocaleString`,
  `toFixed` or a typed "UZS".
- Money is never truncated with an ellipsis. Names may truncate; figures wrap
  or the layout changes.
- Labels are sentence case at weight 500 to 600. No tracked capitals, no
  small "eyebrow" line above a heading.
- Russian words are long: card labels hyphenate (`hyphens-auto`); words never
  break between letters without a hyphen.

## 4. Components

Build pages from `@/components/PresentationFoundation`. No raw `button`,
`input`, `select`, `textarea`, `table`, `dialog`, `details` or headings in page
code.

| Need | Use |
|---|---|
| Page frame | `PageHeader` (title, section tabs, period picker, at most three actions; the rest in `ActionMenu`) |
| A figure for a period | `MetricCard` / `AmountCard` / `StatTile` in `metricGridClassName` |
| A section | `Card` + `SectionHeading` |
| Records | `DataTable` (`mobileCards`, `sticky` first column, `busy`) |
| A details sheet | `Modal` + `DetailHero` + `DetailList` |
| Actions | `Button` (md 44px, sm 36px, lg 48px), `IconButton`, `ButtonLink` |
| Forms | `Field` + `Input` / `CurrencyInput` / `DecimalInput` / `Select` / `Textarea` (grows with text) / `DatePicker` / `MonthPicker` |
| Choice | `SegmentedControl` (solid, soft, chips, tabs), `Checkbox variant="card"` |
| Feedback | `InlineAlert`, `LoadErrorAlert` (with retry), `useToast`, `useConfirm` |
| Nothing to show | `EmptyState` with the next step |
| Loading | a page-shaped `<Page>Skeleton`, never the generic one |
| Concept icon | `IconChip` (tone), `CategoryIcon`, `Avatar` |

Rules:

- `className` on a foundation component only places it (margin, grid span,
  width). Colour, padding, radius or type through `className` means a variant
  is missing: add the variant.
- Radius and shadow come from the component (`rounded-2xl` cards, `shadow-card`,
  `shadow-pop` for overlays). Pages do not set them.
- One primary action per header and per dialog footer. Dialog buttons live in
  the `Modal footer`; Cancel is `secondary`.
- A card that is a filter that is on uses `selected` (one ring, `aria-pressed`).

## 5. Layout

Every admin page, top to bottom:

1. `PageHeader`
2. Headline row: two to five figures
3. Glance: charts that explain the headline
4. Records: the table or list, filters directly above it
5. Dialogs open over the page; they are not sections of it

A page that needs more is two pages. Spacing follows a 4px scale; sections are
`space-y-5`; card grids use `gap-3`.

## 6. Depth and layers

Flat by default: a hairline border and `shadow-card`. Overlays use
`shadow-pop`. Layers, lowest to highest: content, sticky table cells, top bar
and bottom nav, navigation progress, `Modal` / `Drawer`, popovers and pickers,
toasts. Components own their z-index; pages do not write `z-*`.

## 7. Interaction and motion

- **Everything that shows a figure or a record is tappable** and opens what is
  behind it (`href` from `src/lib/detailLinks.ts`, or `onClick`). A ratio or a
  day count stays plain. Never fake a destination.
- Motion has three jobs, all skipped under reduced motion: *arrive*
  (`.page-enter`, `.stagger`, `.grow-x`), *load* (`Skeleton` shimmer),
  *respond* (`.tappable` lift and press, `RollingText`, overlays through
  `motion.ts`). Durations stay at or under 300ms; only opacity and transform.
- No one-off keyframes, hover effects or `animate-pulse` in a page.
- Timings: hover and press under 200ms, arrivals about 280ms, meters 450ms at
  most. Hover lift only on fine pointers (`@media (hover: hover)`); a focus
  ring appears at once and is never animated.
- Programmatic scrolling uses `scrollBehavior()` from `src/lib/scroll.ts`.

## 8. Responsive behaviour

- Phone first: 375px must work with no sideways page scroll; check 320 too.
- Touch targets at least 40px on phones; inputs are 16px on phones (no zoom).
- The sidebar appears at `lg` (1024). 1024 to 1280 is where guessed
  breakpoints fail: prefer layouts that wrap by themselves (`flex-wrap`,
  auto-fit grids) over more breakpoints.
- Above 1536px the page content and top bar are capped (`max-w-screen-2xl`) and
  centred; cards and text lines do not stretch on very wide screens.
- `short:` is the variant for little height (keyboard up, phone on its side):
  `Modal` hides its description and puts footer buttons in one row there.
- `Modal` is a bottom sheet on phones; its title and footer stay in view.
- Tables become cards (`mobileCards`) or scroll inside their own card.

## 9. Do and do not

Do:

- put a new fact on the page that already owns the thing;
- update the page's skeleton in the same change as its layout;
- write copy in `en.json`, `ru.json` and `uz.json` together;
- measure (contrast, overflow, tap size) instead of eyeballing.

Do not:

- put a card inside a card (use `StatTile` or a plain row inside a `Card`);
- write an empty state that only says "No data": say what goes here and give
  the action that fills it;
- decorate: no gradient text, no glass blur except on bars that content
  scrolls under, no coloured side bars on rounded boxes;
- add a card to whichever page is open;
- add a colour for a new meaning without a tone;
- shrink type to make something fit;
- add the game club and the bar together in one chart;
- use `window.confirm`, native date inputs, or a second donut, tooltip or
  legend implementation.

## 10. Prompt guide for agents

When asked for UI in this repository:

1. Read `docs/agents/system-design.md` section 2 to decide where it goes.
2. Find the closest existing page and copy its structure, not its markup.
3. Compose foundation components; add a variant before adding a class.
4. Give every figure a destination or leave it deliberately plain.
5. Add the skeleton, the empty state and the error state with retry.
6. Check 375px, dark and light, and Russian before calling it done
   (`/dr <page>` runs the measured audits).

## 11. Where these rules came from

The page anatomy, tone vocabulary and tappability rules are this project's
own. In November 2026 the file was checked against two public agent design
skills, Impeccable (pbakaus/impeccable) and taste-skill (Leonxlnx/taste-skill).
What fits a dense finance tool was adopted: restrained accent, the full state
matrix per control, no nested cards, no tracked capitals, motion that only
shows a state change and settles within about 300ms, empty states that teach.
What is for marketing pages was not: hero sections, 16px minimum body text,
scroll moments, and their ban on purple (here purple means the owner reserve).

