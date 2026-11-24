# Daily Telegram report: the day's money by payment method

## Goal
The first image of the daily Telegram report ("ФИНАНСЫ ДНЯ") shows the club's
takings and expenses but not how the money came in. The owner wants to see,
for the report's business date, how much came in by cash, terminal and card,
what left each method, and what is left of each for the day, so the evening
count of the till and the terminal slip can be checked against it.

## Placement
Telegram daily report, first image (`buildDailyFinanceReportSvg` or the
equivalent day-image builder in `src/lib/telegram/dailyFinanceReportImage.ts`),
directly under the Club / Bar detail cards and above "СТОИТ ПРОВЕРИТЬ".
The month-level "where the money is" section on the later image stays as is.
Also add one line per method to the text caption only if it stays short;
otherwise leave the caption unchanged.

## Data (no schema change, no migration)
For the report's business date only (same day filter the report already uses):
- In, per method: `cash_income`, `terminal_income`, `card_income` of the day's
  cash rows, plus that day's debt payments bucketed by `payment_method`
  (via `gameClubExpensePaymentBucket`). PlayStation income stays its own
  method row only if it is non-zero (it is already its own bucket in
  `calculateGameClubMoneyLeftByPaymentMethod`).
- Out, per method: the day's Game Club expenses bucketed the same way,
  excluding bar-paid and reserve-paid expenses (same rules as
  `calculateGameClubMoneyLeftByPaymentMethod`).
- Net = in − out.
- Reuse `src/lib/calculations` (`sumGameClubRows`, `gameClubExpensePaymentBucket`,
  `isBarPaidExpense`, `isReservePaidExpense`). If a new pure helper is needed
  (e.g. `calculateGameClubDayByPaymentMethod`), put it in
  `src/lib/calculations/dashboardMetrics.ts` with unit tests, not in the
  Telegram module.
- Show only the club's enabled payment methods
  (`normalizePaymentMethods(club.enabled_payment_methods)` from
  `src/lib/paymentMethods.ts`); the report loader in
  `sendDailyFinanceReport.ts` must select that column scoped to the club.
  A method that is not enabled but still has non-zero money that day is
  still shown, so no money is hidden.
- Bar sales have no payment method in the data; the section header subtitle
  says it covers club money (e.g. "клуб · без бара").

## Design
- A card in the existing style (`card`, `iconTile`, existing glyphs
  `GLYPH_WALLET`/cash, `GLYPH_TERMINAL`, `GLYPH_CARD`, `GLYPH_GAMEPAD` for
  PlayStation), title "ОПЛАТЫ ЗА ДЕНЬ" in the same title style as the other
  sections.
- One tile per method side by side (like the month money tiles): method name,
  the day's net as the big figure, under it "приход X · расход Y" in muted
  text, and the share of the day's takings as a thin bar or percent.
- Russian copy, `money()` formatting with thousands separators, same palette
  constants. No new colours.
- If every method is zero for the day, omit the section.
- Image height must grow to fit; nothing else may overlap or shift wrongly.

## Tests
- Unit tests for the new calculation (income, debt payments, expenses by
  method, bar/reserve-paid excluded, other days excluded).
- `dailyFinanceReportImage.test.ts`: section rendered with the right figures,
  disabled-and-zero method hidden, section omitted when all zero.
- `dailyFinanceReport.test.ts` / `sendDailyFinanceReport.test.ts` updated for
  any new input field.

## Slices
1. Everything above in one slice (calculation + loader + image + tests).

## Risks
- Telegram report is in the reviewer-required list.
- Do not change the month-level money figures.
