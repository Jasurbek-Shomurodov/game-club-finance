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
| Any clickable action | `Button` (`variant`: primary, outline, secondary, ghost, danger, dangerOutline, success), `ButtonLink` for navigation, `IconButton` for icon-only |
| Text / money / select / textarea | `Field` + `Input` / `CurrencyInput` / `Select` / `Textarea` / `Checkbox` |
| Required note on a spending entry (5+ words) | `useEntryNoteGuard` + `NoteField`; call `guard.check(note)` before saving and render `guard.dialog` |
| Multi-select option tiles (payment methods, page access) | `Checkbox variant="card"` |
| Person or product initials | `Avatar` (`tone`: primary for people, neutral for products) |
| Search box | `SearchInput` |
| Mutually exclusive choice (payment method, tabs, filters) | `SegmentedControl` (`variant`: solid, soft, chips) |
| Whole-number quantity | `Stepper` |
| Dates and months | `DatePicker`, `DateRangePicker`, `MonthPicker` |
| Save results, errors, notes | `InlineAlert` (inline) or `useToast` (transient) |
| A load failed | `LoadErrorAlert` (danger alert with the shared Retry button); pair it with `useClubQuery` from `src/lib` |
| Destructive confirmation | `useConfirm` / `ConfirmDialog` (never `window.confirm`) |
| Dialogs | `Modal`, `Drawer` (animated side panel) |
| Collapsible help or secondary list | `Disclosure` (native `<details>` with a chevron summary) |
| "What is this?" beside a heading | `HelpButton` (a `?` that opens a `Modal`; blank lines in `body` start paragraphs) |
| KPI numbers | `MetricCard` (formatted value), `AmountCard` (money with comparison), `StatTile` (compact) |
| Tables | `DataTable` (supports totals row, sticky header, empty state; pass `label` so keyboard users can scroll wide tables) |
| Nothing to show | `EmptyState` |
| Loading | `Skeleton`, `MetricGridSkeleton`, `TableSkeleton`, `FormSkeleton`, `DetailListSkeleton`, `EmployeeCardGridSkeleton`, `ChartSkeleton`, `PageSkeleton` |

Design rules ("quiet surfaces, loud numbers"):

- One accent (`primary-*`) for actions and the current nav item. Colour is
  reserved for meaning: `success` money in / profit, `danger` money out /
  debts, `warning` needs attention. Never tint a section just to label it;
  `Card tone` is deliberately faint and should be rare.
- Numbers are the loudest thing on a page: `MetricCard`/`AmountCard`/
  `StatTile` set them bold with tight tracking and the currency as a small
  muted suffix on the same line. Don't add a coloured icon chip or a sentence
  of explanation under every number; use one subtitle per section or a
  `title=` tooltip.
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

Rules of thumb:

- Components take already formatted strings for money and dates; format with
  `src/lib/formatters.ts` at the call site.
- Every icon-only control needs a `label`; every field needs a `label` or an
  `aria-label`.
- Use the `danger` / `success` / `primary` / `warning` colour tokens rather
  than raw Tailwind reds and greens so the palette stays consistent.
- Money and prices: `Money` shows the translated currency (сум / so'm / UZS)
  by default; `CurrencyInput` keeps the caret in place while separators move
  and ignores a pasted decimal part ("1 500,50" → 1 500).
- Dialogs stack: `Modal`, `Drawer`, `ConfirmDialog`, the date/month pickers and the
  mobile drawer register with one modal stack, so Escape and the Tab focus trap
  only act on the top dialog. A bespoke overlay must use `useModalLayer` +
  `trapFocus` from `./Modal` to join it.
- Overlays animate through `./motion`: `usePresence` keeps an overlay mounted
  while it plays its exit, and `backdropMotion`/`sheetMotion`/`slideMotion`
  give the shared fade, bottom-sheet/scale and side-slide transitions (skipped
  for reduced motion). `Modal` holds its last open content while closing, so
  callers may clear the state that fed it as soon as it closes.
- `SegmentedControl` is a radio group: one Tab stop, arrow keys move and select.
- Toasts appear at the top on phones (never over a bottom sheet's Save button)
  and bottom-right on larger screens; errors stay 8 s and pause on hover/focus.
