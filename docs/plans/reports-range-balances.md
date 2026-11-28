# Reports: money left by payment method follows the selected range

## Goal and user flow

The owner picks a range on Reports (e.g. 12–30 Nov) and expects "Money left by
payment method" (Cash, Terminal, Card, PlayStation, USD) to react. Today the
tiles show the balance at the range's end, counted from the 1st of the month
(`withOpeningBalances` + `openingBalanceRange`). Inside one month, moving the
start date changes nothing visible, so it reads as broken.

The balance itself is right (UZS method balances are running balances that
reset to zero each month, `docs/agents/domain-finance.md` "Collected money").
What is wrong:

1. **Nothing on the tile shows the period.** Fix: each UZS tile keeps the
   balance at the range end as its figure and gets a second line
   "This period: ±X" (the method's own net flow over the range, i.e.
   `report.paymentMethods[m].left` before opening), exactly like the USD tile's
   `usdChangeLabel` line. Show the line only when an opening adjustment applies
   (otherwise the change equals the balance). The section description names the
   date: "Balance on {date} (counted from the 1st of that month)…".
2. **Cross-month ranges double count.** For 12 Oct–30 Nov the cards add
   Oct 1–11 + Oct 12–Nov 30, though the balances reset on 1 Nov. Fix: the
   balance is always the month of `range.to`, first day through `range.to`.
   - Same month (`from` in `to`'s month): unchanged, opening = 1st..from−1, added.
   - Cross month: opening = minus the range's own flows before the 1st of
     `to`'s month (range.from .. endMonthStart−1), so opening + period = the end
     month's balance and the method modal (`MethodDaysModal`) still reconciles
     (days total + period moves = left). Label it differently: "Earlier months
     (reset on the 1st)" instead of "From earlier this month" — in the modal
     and in the Game Club left summary card helper.
3. **Collected money uses the same span.** `collectedFrom` is the 1st of
   `range.from`'s month; for cross-month ranges the held summary
   (`summarizeCollectedMoney`) must only count moves from the 1st of
   `range.to`'s month (collected money also resets monthly). The ledger list on
   the Collected tab may keep showing every move of the range.
4. **"Where the money is now" stays today-only** (intentional). Always show
   its hint line (today's date, regardless of the selected period), not only
   when `whereaboutsNow`, so it is clear in every period.

## Placement

No new page or card. `src/app/(dashboard)/reports/ReportsPage.tsx`,
`PaymentMethodSection.tsx` (`PaymentMethodTiles`), `MethodDaysModal.tsx`,
pure helpers in `src/lib/calculations/moneyReport.ts`.

## Architecture

- `moneyReport.ts`: replace/extend `openingBalanceRange(from)` with a pure
  `openingBalanceSpan(range: {from,to})` returning
  `{ kind: 'earlier', from, to }` (add, same month), `{ kind: 'reset', from, to }`
  (subtract, cross month) or `null` (starts on the 1st of `to`'s month).
  `withOpeningBalances` takes the opening breakdown plus a sign (or the caller
  negates). `openingBalanceTotal` stays consistent with whatever is added.
  Keep `openingBalanceRange` if other callers use it (grep).
- `loadOpening` in ReportsPage fetches the span (same RPC
  `get_money_report_snapshot` + exchanges + reserve moves) and records `kind`.
- Collected held: filter moves by `date >= endMonthStart` before
  `summarizeCollectedMoney` for `held`/taken; keep the full list for the ledger.
- `PaymentMethodTiles`: new optional per-method `change` data and a
  `changeLabel`; tile label gets a second muted line like the USD tile.
- USD is cumulative since `LEDGER_START_DATE` and does not reset; unchanged.

## Data model

None. No migration.

## Design rules

`StatTile` second line as the USD tile already does; `Money` with `showPlus`
for the change; no new colours. Update `ReportsSkeleton` only if tile height
changes. Copy in en/ru/uz together (`reports.*`).

## Tests

- `src/lib/calculations/moneyReport.test.ts`: `openingBalanceSpan` (1st of
  month → null, mid-month → earlier, cross-month → reset, cross-year), and the
  cross-month card sum equals the end month's own balance.
- A test that collected held for a cross-month range counts only the end month.
- Existing Reports tests stay green; e2e only if a spec reads the tile text.

## Audit (record result in the hand-back)

Check every Reports section uses `range`: summary cards, charts, closeout
table, Collected tab, Write-offs tab, export. Day (`/daily-report`) and Month
(`/monthly-report`) tabs have their own pickers: confirm they respect them.

## Slices

1. All of the above in one slice (small, no schema change).

## Risks

- The Telegram report and dashboard use the same helpers; only change
  signatures with every caller updated (`grep -rn openingBalanceRange src`).
