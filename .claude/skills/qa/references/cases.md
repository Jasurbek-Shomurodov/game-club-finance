# QA regression catalog (Game Club Finance)

Severity if failed (`review-core` section 2): **S0** wrong money or data, a
leak across clubs, a crash, or a core flow that cannot be completed (the
`smoke` set); **S1** a broken flow or a misleading UI; **S2** cosmetic.
"Expect" is the pass condition; anything else is a FAIL. IDs are stable;
append new cases at the end of their area, never renumber. `[qa YYYY-MM-DD]`
marks a case added from a finding in that run. `[e2e]` marks a case the
Playwright P0 suite (`e2e/p0.spec.mjs`, run by `npm run test:e2e:full`) covers
on the fixed fixture before every live run; a reproducible S0 finding gets a
test there with its fix.

Writes happen only on a club the user has named as a test club, each one
approved in chat first. Saving an expense or salary also posts to the club's
Telegram group if one is set up.

## Run log (newest first; `retest` starts from the top row)

| Date | Commit | Scope | Findings (S0/S1/S2) | Checks run | Not run |
|---|---|---|---|---|---|

## AUTH — sign-in, clubs and roles

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| AUTH-001 | S0 | Signed-out visitor is redirected [e2e] | Open `/` and `/expenses` in a fresh incognito tab | Lands on `/login`; no club data in the HTML or network responses |
| AUTH-002 | S0 | Another club's data is never visible [e2e] | Sign in as a member of club A, open every dashboard page, then switch to club B | Every figure and list changes; no row from the other club in `read_network_requests` |
| AUTH-003 | S0 | Viewer cannot write [e2e] | As a viewer, open Income, Expenses, Salaries | Save and delete controls hidden; a direct POST to `/api/expenses` returns 403 |
| AUTH-004 | S1 | Pending team member sees the waiting state | Sign in with an unapproved account | Pending screen, no club pages, no data requests |
| AUTH-005 | S1 | Club switch keeps the page and resets the range | On Reports, switch club in the top bar | Same page, data reloads for the new club, no stale flash |
| AUTH-006 | S1 | Team approval and rejection are club scoped | On Team, approve a `QA` request (test club, approved) | The member appears in this club only; `usePendingTeamCount` badge drops by one |
| AUTH-007 | S2 | Session expiry is handled | Clear the auth cookie, then click any nav item | Redirect to `/login` with no console error |

## DASH — dashboard

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| DASH-001 | S0 | Headline totals match the ledgers [e2e] | Hand-compute each side's income, expenses, profit and money left for today from the Income and Expenses pages | Game Club and Bar cards each equal their own sums per `dashboardMetrics.ts`; no card adds the two sides together |
| DASH-002 | S0 | Cash left and profit are different numbers | Compare the cash-left card with the profit card after an owner withdrawal exists | Cash left excludes withdrawn money; profit does not change |
| DASH-003 | S1 | Range picker drives every card and chart | Switch today → this month → last month | All cards and the chart update together; no card keeps the old range |
| DASH-004 | S1 | Fast range switching: last selection wins | Click three ranges quickly | Final cards match the last range; `read_network_requests` shows no out-of-order response applied |
| DASH-005 | S1 | Empty range shows an empty state | Pick a month with no entries | `EmptyState` copy, zero totals, no NaN |
| DASH-006 | S1 | Chart has no future days | View this month mid-month | Series ends at the business today |
| DASH-007 | S1 | Business-day boundary | Before `businessDayStartHour`, open the dashboard | "Today" is the previous business date in every card |
| DASH-008 | S2 | Loading shows skeletons | Throttle the network and reload | Content-shaped skeletons, no layout jump when data arrives |
| DASH-009 | S1 | A money-flow payment opens its details | Open a category from a money-flow Sankey; tap a payment in Payments, then a comment's flow in the chart | Each opens that payment's details (amount, date, category, paid from, method, comment) in the dialog, with Back to the category |

## INC — income

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| INC-001 | S0 | Save an income entry (test club, approved) [e2e] | Income → add `QA income` 150 000, cash, today | Row appears once; dashboard income rises by 150 000 |
| INC-002 | S0 | Double submit writes once | Double-click Save on the approved entry | Exactly one POST in `read_network_requests`; one row |
| INC-003 | S1 | Amount input formats while typing [e2e] | Type `1500000` | Shows `1 500 000`; saved value is 1500000 |
| INC-004 | S1 | Invalid amounts are refused | Enter 0, −5, empty, letters | Field error, no request sent |
| INC-005 | S1 | Payment methods match club settings | Disable `card` in Settings, open the form | Only the configured methods are offered; default is the first configured |
| INC-006 | S1 | Past-date entry lands in the right month | Save (approved) with last month's date | Appears in last month's range only |
| INC-007 | S2 | Cancel discards the draft | Fill the form and cancel | Nothing saved, form reset on reopen |

## EXP — expenses and categories

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| EXP-001 | S0 | Save an expense (test club, approved) [e2e] | Expenses → add `QA expense` 25 000, cash, today | Row once; dashboard expenses rise by 25 000; Telegram post noted under data left behind |
| EXP-002 | S0 | Expense API rejects another club [e2e] | POST `/api/expenses` with a foreign `club_id` | 403 or 404; no row created |
| EXP-003 | S1 | Categories are club scoped | Add a `QA` category (approved); switch club | Category absent in the other club |
| EXP-004 | S1 | Category totals equal the row sums | Compare the per-category summary with the rows filtered to that category | Equal for every category |
| EXP-005 | S1 | Decimal and large amounts | Enter 1 000 000 000 and 12.5 | Large value saved and formatted; decimals rejected where the field is whole UZS |
| EXP-006 | S1 | Error state has retry | Block the expenses request in devtools and open the page | `InlineAlert` with a retry button that reloads |
| EXP-007 | S2 | Long category names do not overflow | Add a 40-character RU name (approved) | Wraps or truncates with a title; no clipped text at 375 px |
| EXP-008 | S1 | Planned expense: plan vs actual [e2e] | Settings → add planned expense `iCafe`, equipment, 500 000 a month; record 650 000 against it from the expense form; Financial analysis for this month | Category and money source locked to the plan; Game Club plan shows 650 000 of 500 000 and +150 000 over |

## STOCK — products, purchases and closing stock

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| STOCK-001 | S0 | A purchase updates stock and expenses once [e2e] | Stock purchase → `QA item` 10 units at 5 000 (approved) | Product stock +10; purchase total 50 000 in expenses; one RPC call |
| STOCK-002 | S0 | Closing stock saves a snapshot [e2e] | Closing stock → save today's count (approved) | Snapshot stored; later editing the purchase price does not change the saved count value |
| STOCK-003 | S0 | Stock value math [e2e] | Hand-compute units × unit price for a product | Products page value equals `src/lib/calculations/stock.ts` output |
| STOCK-004 | S1 | Fractional unit prices survive | Purchase at 1 250.5 per unit (approved) | Stored and shown with the fraction via `formatUnitCurrency` |
| STOCK-005 | S1 | Zero stock product | View a product with 0 units | Shows 0, no NaN or negative value |
| STOCK-006 | S1 | Cost prices hidden from non-privileged roles | Open Products as a viewer | No cost price column; the network payload carries no cost field |
| STOCK-007 | S2 | Product search filters the table | Type part of a name | Table filters client-side with no extra request |

## DEBT — debts and payments

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| DEBT-001 | S0 | Payment reduces the balance through the ledger [e2e] | Add a `QA debt` 100 000, then a payment 40 000 (both approved) | Balance 60 000; two ledger rows; parent updated by the database, not a second client write |
| DEBT-002 | S0 | History cannot be edited or erased [e2e] | Look for edit or delete on a payment row | None offered; no update or delete request possible from the UI |
| DEBT-003 | S1 | Overpayment is refused | Pay 70 000 on a 60 000 balance | Validation error, no request |
| DEBT-004 | S1 | Settled debts move out of the open list | Pay the remaining 60 000 (approved) | Listed under settled; open total excludes it |
| DEBT-005 | S1 | Debt totals agree with the dashboard | Compare open debt total with the dashboard debt card | Equal |
| DEBT-006 | S2 | Creditor names localize nothing | Enter a Cyrillic name (approved) | Shown identically in EN, RU, UZ |

## OWN — owner money and balance

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| OWN-001 | S0 | Owner withdrawal uses the RPC and lowers cash left | Money taken → withdraw 50 000 (approved) | One `.rpc` call; cash left −50 000; profit unchanged |
| OWN-002 | S0 | Balance page equals ledgers | Hand-compute available money from income, expenses, salaries, withdrawals | Equals `availableMoney.ts` output shown on Balance |
| OWN-003 | S1 | Withdrawal over available money is refused | Enter more than cash left | Validation error, no request |
| OWN-004 | S1 | Owner profit snapshot matches the month report | Compare Money taken summary with the Monthly report profit | Equal for the same month |
| OWN-005 | S2 | Notes field keeps line breaks | Enter two lines (approved) | Rendered on two lines |

## SAL — salaries and team

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| SAL-001 | S0 | Salary payment saved once | Salaries → pay `QA staff` 300 000 (approved) | One row; expenses include it; Telegram post noted |
| SAL-002 | S0 | Deactivated staff excluded from total due | Deactivate a `QA staff` member (approved) | Total due drops by their amount; history kept |
| SAL-003 | S1 | Partial payments accumulate | Two payments 100 000 + 50 000 (approved) | Due shows remaining 150 000 of 300 000 |
| SAL-004 | S1 | Month switch changes the due list | Open last month | Last month's payments and due only |
| SAL-005 | S1 | Salary API checks the club | POST `/api/salaries` with a foreign `club_id` | 403 or 404 |
| SAL-006 | S2 | Team roles display translated | Switch to UZ on Team | Role names in Uzbek, no raw keys |

## REP — reports and analysis

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| REP-001 | S0 | Daily report equals the dashboard for the same day | Open Daily report and Dashboard for today | Every shared figure identical |
| REP-002 | S0 | Monthly report sums the daily reports | Sum a month's daily income manually | Monthly income equals the sum |
| REP-003 | S0 | Money details separate profit from cash left | Open Game club and Bar money details | Both show profit and cash left as different numbers; bar and game club split per `barMoney.ts` |
| REP-004 | S1 | Financial analysis respects the range | Switch range | Charts and tables reload; no future points |
| REP-008 | S1 | Each side's money flow, and a category's payments [e2e] | Read the Game Club and Bar Sankeys in Financial analysis, then tap a category | Game Club and Bar flows show their own figures from the ledgers and are never combined; a category opens a dialog with the money that paid it and its payments |
| REP-005 | S1 | Recent transactions page pages past 1,000 rows | Pick a range with many rows | Total matches the ledger sum; `fetchAllRows` evident in the request pattern |
| REP-006 | S1 | Reports export, if present, matches the screen | Export the month | File totals equal the page |
| REP-007 | S2 | Empty month | Pick a month with no data | Empty states, no NaN |

## CASH — daily cash

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| CASH-001 | S0 | Daily cash entries sum per method | Enter cash and terminal entries (approved) | Summary per method equals `dailyCashSummary.ts` output |
| CASH-002 | S0 | Day boundary | Before the business-day start hour | Entries attach to the previous business date |
| CASH-003 | S1 | Editing an entry replaces, not duplicates | Edit the approved entry | One row; summary updated |
| CASH-004 | S1 | Methods limited to club settings | Disable terminal in Settings | Terminal not offered on Daily cash |
| CASH-005 | S2 | Entry list ordered newest first | Add two entries | Newest at the top |

## SET — settings and promotions

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| SET-001 | S0 | Payment method subset saves and applies | Toggle a method (approved) | Every form offers only the configured subset; normalized via `paymentMethods.ts` |
| SET-002 | S1 | Business-day start hour saves | Change the hour (approved) | Dashboard "today" follows the new boundary |
| SET-003 | S1 | Telegram settings never show the token | Open Settings | No bot token in the page or responses; chat id only |
| SET-004 | S1 | Promotions are club scoped | Add a `QA promo` (approved); switch club | Absent in the other club |
| SET-005 | S2 | Club logo upload states | Upload a PNG (approved) | Preview, then saved; error shown for a 10 MB file |

## HIST — edit history

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| HIST-001 | S0 | A deleted or edited entry stays readable `[e2e]` | Delete or correct a `QA` entry (approved); open `/history` | The entry with its old values, who changed it and when; the history cannot be deleted through the API |
| HIST-002 | S0 | The history is owner-only | Sign in as an admin or viewer | No Edit history link; `/history` redirects; `entry_audit_logs` returns no rows |
| HIST-003 | S2 | Telegram and debt-total updates add no rows | Pay part of a debt; post an expense to Telegram | Only the payment's own entry changes, no history row for the debt or the message id |

## I18N — languages and formats

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| I18N-001 | S1 | No missing keys in any language | Switch EN → RU → UZ on every page | No raw `page.key` ids, no English fallback in RU/UZ |
| I18N-002 | S1 | Money and dates follow the language | Compare a date and a total in each language | `1 000 000` grouping; localized month names |
| I18N-003 | S1 | Language switch keeps state [e2e] | Switch language on Reports with a range selected | Range and page kept; no reload |
| I18N-004 | S2 | Long RU/UZ strings fit | Check nav, buttons and table headers in RU at 375 px | No clipped or overlapping text |

## UI — themes, widths, console

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| UI-001 | S0 | Phone width usable [e2e] | 375 px on every page | No horizontal scroll; tables scroll inside their card; controls reachable |
| UI-002 | S1 | Dark theme readable | Toggle dark on every page | No white-on-white; charts and tooltips themed |
| UI-003 | S1 | No console errors or hydration warnings | `read_console_messages` after each page load | Empty of errors and React warnings |
| UI-004 | S1 | Tablet and desktop widths | 768, 1280, 1920 px | Grids reflow; no stretched empty cards |
| UI-005 | S2 | Skeletons do not flash | Fast network reload | No visible flash shorter than a frame |

## NET — network behaviour

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| NET-001 | S1 | First load request count | `read_network_requests` on Dashboard | One bootstrap RPC or a small fixed set; no per-card queries |
| NET-002 | S1 | No N+1 | Open Products and Debts | Request count independent of row count |
| NET-003 | S1 | No failed requests | Every page | No 4xx or 5xx |
| NET-004 | S1 | Slow responses noted | Every page | Nothing over 1 s except documented heavy reports |
| NET-005 | S2 | Payload size | Largest response per page | No column the page does not render |

## TG — Telegram report

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| TG-001 | S0 | Report figures equal the dashboard | Read the last delivered report in the club's group | Every figure equals the dashboard for that date |
| TG-002 | S0 | Cron endpoints refuse without the secret | `curl -i` the cron route without a header | 401, no report sent |
| TG-003 | S1 | Retry routes do not resend a delivered report | Read `sendDailyFinanceReport.ts` delivery tracking | A delivered date is skipped by retry 1 and 2 |
| TG-004 | S1 | Expense and salary posts render amounts formatted | Read a recent post | `1 000 000` grouping, category and note present |
| TG-005 | S2 | Report language follows the club | Club language UZ | Report in Uzbek |

## XAPP — cross-page consistency

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| XAPP-001 | S0 | After a money action, every surface agrees [e2e] | After INC-001, EXP-001, SAL-001 and OWN-001: Dashboard, Money details, Daily report, Monthly report, Financial analysis, Balance | Identical totals everywhere for the same range |
| XAPP-002 | S0 | Accounting profit never equals cash left when withdrawals exist | Any club with a withdrawal | The two figures differ by the withdrawals |
| XAPP-003 | S1 | Range and club selection persist across pages | Set a range, navigate | Same range on the next page |
| XAPP-004 | S2 | Number formatting identical across pages | Same amount on three pages | Same grouping and unit |
