# Dollar-account expenses without a rate

## Goal and user flow

The owner reserve has two accounts: a **UZS account** and a **USD account**.

- An expense paid from the **USD account** only subtracts its dollars. The form
  asks for the dollars and nothing else: no exchange rate. The market rate
  changes every day and has nothing to do with dollars that were already bought.
- An expense paid from the **UZS account** subtracts sums. When the price was
  quoted in dollars, the form can convert it: dollars × a rate the person types
  = the sums subtracted.

Today the USD path asks for a rate (prefilled from the latest exchange) and books
`amount = round(usd_amount × usd_rate)`. Whatever is typed there distorts the
reserve: the dollars leave at a made-up price, so the "Bought for / Average" of
the dollars still held drifts (Pixel: rent $1 250 and a game $90 typed at 12 000
while the dollars cost about 12 022).

Flow after the change (Expenses form, source = Reserve):

1. Account: `UZS account` (owner only) or `USD account`.
2. USD account: one field, dollars. Hint shows what is left in the account and,
   once filled, "Counted as about N UZS in expenses". Save.
3. UZS account: sums as today, plus a small "Price in dollars" switch that shows
   dollars and rate and fills the sums field with the product.

## The one accounting rule (confirm with the owner before slice 1)

Every report, profit figure and the Telegram daily report counts expenses in UZS
from `expenses.amount`. A dollar expense therefore still needs a sums figure even
though nobody types a rate. It is set by the database, not the person:

> A USD-account expense is counted at **what its dollars cost**: the average
> purchase price of the dollars held just before it.
> `usd_rate = round(sums value of dollars held / dollars held, 2)`,
> `amount = round(usd_amount × usd_rate)`.

Consequences: the average price of the remaining dollars does not move when
dollars are spent (only buying or selling moves it), a rate gain or loss is still
never profit (domain-finance.md l.180-194), and `expenses_usd_amounts` (124) keeps
holding unchanged. `usd_rate` stays as a stored column but changes meaning from
"rate the person entered" to "cost per dollar".

## Placement

No new page or card. Everything joins what already owns it:

- Form: `src/components/expenses/ExpenseRegistrationForm.tsx` (used by Expenses,
  Reports "Register expense" and Reserve "Pay from reserve").
- Reserve page keeps the two holdings; they are renamed accounts.
- Details: Reports `EntryDetailsSheet`, Reserve `ReserveHistoryList`, entry
  history, Telegram expense notices.

## Architecture

- `POST /api/expenses`: a usd body carries `usdAmount` only. `usdRate` becomes
  optional and is ignored (kept in the validator so an old client mid-deploy is
  not rejected). The route no longer computes `amount` for usd; it inserts and
  reads back `amount, usd_rate` from the row.
- Database decides the price (atomic with the balance check, no client race).
- `get_expense_method_balances` additionally returns `usdCostRate` (cost per
  dollar now) so the form can show "Counted as about N UZS". `usdRate` (latest
  exchange) stays in the payload and is used only by the UZS-account converter.
- `src/lib/paymentMethods.ts` `dollarExpenseAmount` stays (preview + converter).
- No new `src/lib/calculations` function is needed for balances:
  `reserveBalances` and `reserveDollarRates` already read `amount`; they become
  correct once `amount` is the cost. Add tests that pin "spending dollars leaves
  the average unchanged".

## Data model

Migration A (slice 1), non-destructive, re-runnable:

- `dollar_cost_rate(p_club_id uuid, p_exclude_expense uuid default null) returns numeric`
  security definer, revoked from public/anon/authenticated:
  sums value = Σ `from_amount` of exchanges into usd − Σ `to_amount` of exchanges
  out of usd − Σ `amount` of usd expenses (all time, as `owner_reserve_balance`
  143 reads the `'usd'` bucket); dollars = `expense_method_balance(club,'usd')`
  semantics (136:305-318). Returns `round(value / dollars, 2)`, or null when
  dollars ≤ 0 or value ≤ 0.
- `price_dollar_expense()` BEFORE INSERT trigger on `expenses`, for
  `payment_method = 'usd'` rows written by a signed-in user (`auth.uid()` not
  null; service-role seeds and migrations keep the values they pass, which keeps
  the existing migration tests and fixtures valid): takes the same advisory lock
  the balance trigger uses, sets `usd_rate := dollar_cost_rate(club)` and
  `amount := round(usd_amount * usd_rate)`. When the cost rate is null (no
  dollars) it leaves the row alone so the existing balance trigger raises
  `INSUFFICIENT_BALANCE` as today. Must be ordered before
  `expenses_method_balance` / the check constraint sees the row (trigger name
  ordering; verify).
- `get_expense_method_balances`: add `usdCostRate` to the returned json. Keep
  every existing key (compatibility, AGENTS.md invariant 8).
- Deleting a usd expense needs nothing: its `amount` returns to the bucket.
- Edge to state in the migration header and domain doc: a backdated dollar
  expense is priced at today's cost, the same all-time basis the dollar limit
  uses (136).

Migration B (slice 2), **DESTRUCTIVE**, guarded like 181/182: reprice Pixel's two
existing dollar expenses at cost, in date order, each matched on id + its current
values, raising on any other state, no-op where the rows do not exist:

| Expense | Now | Becomes |
|---|---|---|
| 31 Oct rent $1 250 | rate 12 000.00, amount 15 000 000 | rate 12 022.25, amount 15 027 813 |
| 24 Nov equipment $90 | rate 12 000.00, amount 1 080 000 | rate 12 022.26, amount 1 082 003 |

(Bought: 16 863 000 + 4 356 275 = 21 219 275 for $1 765. Builder recomputes
these with `dollar_cost_rate` logic rather than trusting this table, and reads
the ids from production values given by the orchestrator.) Checks before
writing: which triggers fire on UPDATE of `expenses` (`lock_collected_day` 097,
`expenses_method_balance` 125/136, `expenses_never_negative` 169,
`guard_reserve_expense` 155, salary/shortage protectors, audit 111) and that
table UPDATE being revoked (083) does not stop the migration role. Reviewer
required.

RLS, indexes: unchanged.

## Design rules

- Vocabulary, all three locales together, same message shapes:
  `reservePage.sumsPot` / `dollarsPot` → "UZS account" / "USD account"
  (ru "Счёт в сумах" / "Долларовый счёт", uz "So'm hisobi" / "Dollar hisobi");
  `expenses.reserveMethods.sums` / `.usd` likewise; the method field label on the
  reserve source reads "Account". `reservePage.dollarsBoughtFor` and
  `averageRate` keep their meaning (now exact).
- Remove from the USD path: `expenses.usdRate`, `usdRateHint`, `usdRateRequired`
  usage. `usdInSums` becomes "Counted as about {amount} {currency} in expenses".
  The keys the UZS converter still needs stay.
- A dollar expense leads with dollars wherever it is shown: Reports details
  sheet and Reserve history show `$90` with "Counted as 1 082 003 UZS · cost
  12 022.26 per $1" beneath; `reports.exchangeRate` is not used for it any more.
  Reserve history must load `usd_amount` (bundle `reserveExpenses` lacks it:
  170:313-321 → add the column in migration A's bundle redefinition, or read it
  from `dollarExpenses`; builder picks the smaller change). Fix the delete
  confirm that formats the sums amount as dollars (`ReservePage.tsx:244`).
- Telegram (`expenseNotification.ts`, `entryChangeNotification.ts`): header
  "🏦 Расход из резерва: $90", details "Долларовый счёт · …", no "по курсу".
  The sums figure is not shown in the notice.
- Entry history label `history.fields.usd_rate`: "Cost per dollar".
- Components from `PresentationFoundation` only (`Field`, `DecimalInput`,
  `CurrencyInput`, a `Switch`/checkbox that already exists there for the
  converter); money through `formatCurrency` / `formatUnitCurrency` /
  `formatDollars`. No skeleton shape changes are expected (one field fewer in a
  modal form); update the form's skeleton if it has one.

## Tests

- Migration test for A (new `dollarCostExpensesMigration.test.ts`): buy $100 for
  1 200 000 and $100 for 1 300 000, spend $50 as a signed-in user → row
  `usd_rate 12500.00`, `amount 625000`; `owner_reserve_balance('usd')` 1 875 000
  for $150 (average still 12 500); client-supplied rate ignored; service-role
  insert keeps its rate; no dollars → `INSUFFICIENT_BALANCE`; balances RPC
  returns `usdCostRate`.
- Update: `usdExpensesMigration.test.ts`, `expenseBalanceLimitMigration.test.ts`,
  `dollarsInReserveMigration.test.ts`, `ownerMoneyBundleMigration.test.ts` only
  where they insert as a signed-in user and assert the typed rate.
- `src/app/api/expenses/route.test.ts` l.296-312: rate optional and ignored,
  amount comes from the row.
- `ownerReserve.test.ts`: spending dollars at cost leaves `averageRate` unchanged.
- Telegram tests: new wording.
- `e2e/p0.spec.mjs` EXP-011: no rate field on the USD account; $20 saves with
  the cost rate from the fake backend (`e2e/fake-supabase.mjs` must price the
  row the same way); the "Only $80 is left" limit stays.
- Migration B: in-memory check as for 182.

## Slices

1. **USD account asks no rate.** Migration A, API, form (USD path only), the
   balances payload, vocabulary of the two accounts in the form and on the
   reserve page, tests and e2e. Reviewer: yes (financial formula, migration).
2. **Reprice the two existing dollar expenses** (Migration B). Reviewer: yes.
   Destructive: needs the owner's yes before the push. After it: reserve card
   shows $425, bought for 5 109 459, average 12 022.26.
3. **Dollars first in every view.** Details sheet, reserve history (+ delete
   confirm), entry history label, Telegram notices, docs
   (`domain-finance.md` l.90-101 and reserve section, `database.md` l.17, l.33,
   l.113 and the missing 155/170 notes touched by this).
4. **UZS-account converter.** "Price in dollars" switch on the UZS account:
   dollars × typed rate fills the sums; saved as an ordinary reserve purchase in
   sums (no new columns).

## Risks and open questions

- **Open (owner):** the accounting rule above. The alternative, counting a
  dollar expense as 0 UZS, would drop October's rent out of October's profit.
- Slice 4 keeps no record of the dollars/rate used for the conversion. If the
  owner wants them kept, that is two nullable columns on reserve purchases and a
  relaxed 155 guard: a separate decision.
- Trigger ordering on `expenses` INSERT (price → balance → never-negative) must
  be verified against the real trigger names.
- Non-owners can pay from the USD account today (form l.149-152); unchanged.
- Old client during deploy still sends `usdRate`; it is ignored, not rejected.
