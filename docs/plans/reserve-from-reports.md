# Put money into the reserve from Reports, and a clearer entry sheet

## Goal and user flow

An owner looking at Reports can set Game Club money aside in the owner reserve
without leaving the page, by payment method (cash, terminal, card,
PlayStation):

1. **From an income entry.** Tap a "Daily club income" row → the entry sheet
   shows the money by method as rows. An owner sees "Move to reserve" (all
   methods) and a small reserve action on each method row (that method only).
   Either opens the deposit form with the entry's date and the amounts filled
   in.
2. **From the page.** In "Where the money is", beside the "In the reserve"
   tile, an owner has "Put in". It opens the same form for today, each method
   filled with what the till can give.
3. The form: date, one amount per method, optional note, Save. On save the
   report reloads, a toast confirms, and the club's Telegram group gets the
   existing reserve notice.

Non-owners see none of this. Nothing here links a deposit to one income row:
a deposit is, as today, money of a method leaving the till on a date
(`owner_reserve_entries.entry_date`). The entry only supplies the date and the
starting amounts.

## Placement

- The reserve's home stays `/reserve` (system-design section 2). Reports only
  *launches* the recording form (rule 2): one form component, three launchers.
- Launchers: the entry sheet (Reports closeout), the "Where the money is" card
  on Reports (`MoneyWhereabouts` in `PaymentMethodSection.tsx`), and the
  `/reserve` page header next to Pay and Return (the home had no "put in"
  button; Owner Profit keeps its own month-based form untouched).
- Not a fourth `PageHeader` action on Reports: the header already holds three
  for an owner, which is the limit.
- The entry sheet shows "In the reserve from this day" as one line linking to
  `reserveHistoryHref()`; it does not rebuild the reserve ledger.

## Architecture

No new route, RPC or migration. Everything goes through what exists:

- `requestReserveMove` (`src/lib/ownerReserveRequests.ts`) → `POST /api/reserve`
  with `kind: 'deposit'`, `source: 'game_club'`, `month` = the date's month,
  `date`, one part per method with a fresh `crypto.randomUUID()` id (kept in a
  ref for the form's lifetime so a retried submit is stored once, like
  `CollectMoneyForm`). The RPC `move_owner_profit_to_reserve` already checks
  owner access, the month's available profit, the day's till balance and a
  closed day.
- `fetchCollectionBalances(supabase, clubId, date)`
  (`src/lib/supabase/moneyCollections.ts`) gives what the till holds per
  method on the chosen date; it is the cap shown beside each field.

New code:

- `src/components/owner-reserve/ReserveDepositModal.tsx` (shared by two
  routes, so it lives in `src/components`). Props: `open`, `onClose`,
  `onSaved`, optional `initialDate`, optional `initialAmounts`
  (`Partial<Record<OwnerWithdrawalPaymentMethod, number>>`). Model it on
  `src/app/(dashboard)/reports/CollectMoneyForm.tsx` (same `Modal`,
  `useModalForm`, `DatePicker` capped at the business today, `CurrencyInput`
  per method with `PAYMENT_METHOD_ICONS`, "available" helper under each field,
  a total line, `Textarea` note, `InlineAlert` for errors, submit disabled at
  zero total). Methods shown: the club's enabled ones, plus any whose till is
  above zero, plus PlayStation only when its till is above zero (the Collect
  form's rule). Changing the date reloads the balances and re-clamps.
  Failures map to the existing `ownerReserve.errors.<code>` messages.
- `reserveDepositPrefill(wanted, till)` in
  `src/lib/calculations/ownerReserve.ts`: per method
  `min(max(wanted, 0), max(till, 0))`, or the whole till when nothing was
  asked for (the page launcher); returns whole sums. Unit-tested.
- `EntryDetailsSheet.tsx`: see Design rules. New props: `canMoveToReserve`,
  `reservedThatDay` (number), `onMoveToReserve(amounts)`.
- `ReportsPage.tsx`: state for the deposit modal (`{ date, amounts } | null`),
  owner-only; closes the entry sheet when the form opens; on save toast +
  `reloadReport({ silent: true })`. `reservedThatDay` comes from
  `reportRows.reserveMoves` already loaded (deposits of `game_club` on the
  entry's date).
- `ReservePage.tsx`: a "Put in" button opening the same modal; reload on save.

State lives in the modal; pages only hold open/closed and the prefill.

## Data model

Unchanged. No migration.

## Design rules

- Components only from `PresentationFoundation`; reserve colour through
  `tone="reserve"` / `PiggyBank` (as `ReserveSection`), no new palette or
  keyframes.
- Entry sheet upgrade (same `Modal`, `DetailHero`, `DetailList`):
  - Payment methods of a split entry become a list of rows instead of outline
    badges: method icon chip, label, amount right-aligned and tabular, and a
    thin share bar under it using `.grow-x`. Zero methods stay hidden; a
    negative part shows in the danger tone without a bar.
  - Owner + income entry + Game Club money: each positive row ends with an
    `IconButton` (PiggyBank, aria-label "Move {method} to reserve"), and the
    modal footer has a `Button` "Move to reserve" for all positive methods.
    Both call `onMoveToReserve`.
  - A ticked ("closed") day does not hide the reserve actions: since 169 the
    tick moves no money and the deposit RPC does not refuse it. The form's
    till cap decides what can move.
  - "In the reserve from this day" line (only when above zero), linking to
    `reserveHistoryHref()`.
  - The description moves out of the right-aligned list into its own
    full-width block under the list, so a long note reads as text.
  - Everything an owner could already correct on an expense keeps working.
- Tappable targets: tiles and rows use `href`/`onClick` props, never a
  hand-written `<button>` around a card.
- Money: `Money`, `formatCurrency`, `formatCurrencyInput`/`parseCurrencyInput`.
  Dates: `DatePicker`, `formatDateOnly`. The date is the club's business date
  (`useBusinessToday`).
- Skeletons: the modal shows field skeletons while balances load; if the
  "Where the money is" card changes shape, `ReportsSkeleton.tsx` and
  `ReserveSkeleton.tsx` follow.
- Copy in `en.json`, `ru.json`, `uz.json` together, same shapes. Reuse
  `ownerReserve.errors.*` and `depositedToast`.

## Tests

- Unit: `reserveDepositPrefill` (caps, negatives, empty request, whole sums).
- Component: `EntryDetailsSheet` (owner sees the actions on an income entry;
  a non-owner, an expense and a closed day do not; a row action passes only
  its method). `ReserveDepositModal` (sends one part per non-zero method with
  the date's month; shows a refusal).
- `src/app/(dashboard)/loadingSkeletons.test.tsx` if a skeleton changes.
- `e2e/`: update any spec that opens the Reports entry sheet or asserts its
  payment badges; add the reserve launcher to the Reports spec if the suite
  has owner coverage there.

## Slices

1. **Deposit form and page launchers.** `reserveDepositPrefill` + tests,
   `ReserveDepositModal`, "Put in" on Reports "Where the money is" and on
   `/reserve`, translations, skeletons. Ships on its own.
2. **Entry sheet.** The redesigned `EntryDetailsSheet` with method rows, the
   reserve actions wired to the slice 1 modal, the "from this day" line,
   tests and e2e.

## Risks and open questions

- A deposit also needs the month to have that much owner profit left in the
  method; the form shows only the till cap and lets the server refuse with
  `exceeds_available`. Acceptable: the message already says what to do.
- Bar money is out of scope here (Bar has no methods and no till); it stays on
  Owner Profit.
- The deposit is by date and method, not tied to the tapped entry. Tying it
  would need a new column and is not proposed.
