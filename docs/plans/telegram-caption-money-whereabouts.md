# Telegram report caption: where the money is

## Goal and user flow

The daily report's photo caption (the text under the album in Telegram, built by
`formatRussianDailyFinanceReportCaption` in `src/lib/telegram/dailyFinanceReport.ts`)
currently opens with:

```
📊 Ежедневный финансовый отчёт
Рабочий день: 24 ноября 2026
⚠️ Заканчивается на складе: 15
```

The owner wants those three lines gone (the image already shows the title, the
date and the low-stock list) and the caption to answer "how much money do we
have, and where" at a glance:

```
👛 У администратора: 1 234 000 сум
💼 Собрано: 2 000 000 сум
🏦 В резерве: 15 000 000 сум + 1 200 $
💰 Всего денег: 18 234 000 сум + 1 200 $
```

followed by the remaining caption lines unchanged (internet due tomorrow, promo
bonuses, write-offs, corrections, money checks). The low-stock count is dropped
from the caption only; the low-stock block in the image and in the full text
report (`formatRussianDailyFinanceReport`) stays. The full text report keeps its
own header.

## Placement

Telegram daily report only (caption of the first album photo). The figures are
the same three as the "Where the money is" cards on Reports
(`MoneyWhereabouts` in `src/app/(dashboard)/reports/ReportsPage.tsx`):
`kassaTotal`, `collectedSummary.held.total`, `reportRows.reserveSums`. They must
match that page for the report's business date (as of the end of that day).

## Architecture

- `DailyFinanceReportInput` gains an optional `moneyWhereabouts?: { kassa: number; collected: number; reserveSums: number; reserveUsd: number }`.
  Absent (e.g. a fetch failed) → the four lines are omitted, never shown as 0.
- `sendDailyFinanceReport.ts` loads what it needs beside the existing
  `Promise.all`: collected money moves (`fetchCollectedMoneyMoves`, month start
  through the business date, the same window Reports uses) and the reserve
  holdings (`get_owner_reserve_balances`; check it works with the client the
  cron uses — if the RPC gates on an owner session, read the balances another
  safe way or fall back to omitting the lines; do not weaken the RPC).
  Reserve USD: the USD account balance (`game_club.usd` in the RPC payload;
  `fetchReserveHoldings` currently drops it — extend it rather than duplicating).
- Admin's kassa: reuse the exact Reports logic (payment-method money left with
  opening balances, minus what the collector holds, `moneyStillHeld` per
  `COLLECTED_METHODS`). If that logic only lives inside `ReportsPage.tsx`,
  extract the pure part into `src/lib/calculations` and use it from both places
  so the two can never drift. No new formula.
- Total = kassa + collected + reserve sums; dollars shown beside it, not
  converted. Omit the "+ N $" part when the USD balance is 0.
- Formatting: existing `money()` helper for sums; dollars with thousands
  separators.

## Data model

One non-destructive migration, `186_collected_money_moves_service_role.sql`:
`grant execute on public.get_collected_money_moves(uuid, date, date) to
authenticated, service_role` (as 156 does for `get_reserve_moves`). 169
granted it only to `authenticated`, so the cron's service-role read would
otherwise rely on default privileges. The reserve needs no grant: it is read
from its tables (`fetchOwnerReserve` + `reserveHoldingsOn`), because
`get_owner_reserve_balances` refuses a caller without an owner session.

## Tests

- `dailyFinanceReport.test.ts`: caption without the three old lines; with
  whereabouts (with and without USD); without whereabouts.
- `sendDailyFinanceReport.test.ts`: the expected caption strings; the new
  fetches are mocked; a failed whereabouts fetch still sends the report.
- Unit test for any extracted kassa calculation; Reports page behaviour unchanged.
- Caption stays under `TELEGRAM_CAPTION_MAX_LENGTH`.

## Slices

1. Everything above in one slice (caption + data + shared kassa function + tests).

## Risks

- Owner-only RPC under the cron's client → the reserve is read from its ledgers instead; collected money is granted to the service role by 186; any failed read still drops the lines, never the report.
- Kassa must equal the Reports card for the same date; reviewer checks this.
