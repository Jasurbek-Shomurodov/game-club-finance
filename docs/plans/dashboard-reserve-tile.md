# Dashboard: "In the reserve" tile replaces Bar Net Profit

## Goal and user flow

The owner opens the Dashboard and, in the top row of five tiles, sees how much
is left in the reserve right next to the month's income and profit. Tapping it
opens `/reserve`.

The Bar Net Profit tile leaves the top row: the same figure is already shown in
the month-at-a-glance Bar card ("Profit" + margin ring), so it was a duplicate.

## Placement

- Area: Dashboard (`src/app/(dashboard)/dashboard/DashboardPage.tsx`), the top
  `AmountCard` row, last slot (where `barNetProfit` is now).
- `docs/agents/system-design.md` §2: the reserve's home is `/reserve`; other
  pages "may show the balance, as a link". This tile is exactly that: a balance
  plus a link, no breakdown rebuilt here.
- Links to: `reserveHistoryHref()` / `/reserve` from `src/lib/detailLinks.ts`
  (use whichever is the reserve's overview link; through `pathIfAllowed`).

## What the tile shows

- **Label:** "In the reserve" (current month) / "Reserve at end of {month}"
  (a past month). Translations in en/ru/uz.
- **Amount:** the reserve's sums, `reserveHoldingsOn(reserve, date).sums`, at:
  - the business today when the selected month is the current month;
  - the last day of the selected month when it is a past month.
  This is the same canonical figure the daily Telegram report shows as "in the
  reserve" (`sendDailyFinanceReport.ts` → `fetchOwnerReserve` +
  `reserveHoldingsOn`). Do not write a new formula.
- **Dollars:** when `usd > 0`, the helper's first line is "+ $1 200 in dollars"
  (formatted with thousands separators, as the Telegram report / Reserve page
  format USD). The dollars are not converted into the sums.
- **Helper (month flow):** "+{deposited} in · −{out} out this month" from
  `reserveForMonth(entries, expenses, month)` summed over both sides
  (in = deposited; out = returned + spent). Hide the line when both are zero.
  If `reserveForMonth` is not quite the right shape for the data
  `fetchOwnerReserve` returns, add a small pure helper next to it in
  `src/lib/calculations/ownerReserve.ts` with a unit test rather than computing
  in the component.
- **Icon / tone:** the reserve icon the Reserve page uses (PiggyBank or
  whatever `ReservePage` uses), `accent="reserve"` if `AmountCard` supports it,
  otherwise the purple `reserve` tone from `PresentationFoundation/tone.ts`.
  No comparison chip.

## Access

`/reserve` is owner-only (`featureForPath` → `team`). Show the tile only when
`pathIfAllowed('/reserve')` / `canAccessPath` allows it, and only fetch the
reserve in that case. When not allowed, the row has four tiles; make sure the
grid still looks right (check the grid's column classes).

If the reserve is not supported (`reserveSupported === false`) or the read
fails, show the tile without an amount in a muted "—" state rather than 0, or
hide it; never show a false 0. Never block the rest of the dashboard on it.

## Data / state

- No migration. No schema change. Read-only.
- Fetch with `fetchOwnerReserve(supabase, clubId, date, isCurrent)` from
  `src/lib/supabase/ownerMoney.ts` in the dashboard's existing load effect (or
  a parallel effect keyed on club + month), respecting the stale-response guard
  the page already uses. Scope to the selected `club_id`.
- Dates via `src/lib/utils.ts` / `useBusinessToday` helpers; month end from the
  existing helpers, no ad hoc date math.

## Removal

- Remove the `barNetProfit` `AmountCard` and its now-unused locals
  (`barProfitComparison`, etc.) from the dashboard. Keep the `barNetProfit`
  message key: `src/lib/telegram/dailyFinanceReportImage.ts` still uses it.
  Remove `barNetProfitDesc` only if nothing else references it.

## Design rules

- `AmountCard` from `PresentationFoundation`, `href` from `detailLinks.ts`.
- Skeleton: `DashboardSkeleton.tsx` keeps five top tiles (same count), and the
  tile uses the existing `loading` prop.
- Three locales updated together with matching shapes.

## Tests

- Unit test for any new pure helper (month in/out totals).
- `e2e/`: grep for the Bar Net Profit tile on the dashboard (`p0.spec.mjs`,
  `helpers.mjs`, `fixture.mjs`) and update to the new tile if referenced.
- Gate: typecheck, lint, test, build.

## Slices

1. The whole change above (one slice, no migration).

## Risks

- Past month: the balance must be at month end, not today, so a past month
  never shows later moves (`reserveHoldingsOn` already filters by date).
