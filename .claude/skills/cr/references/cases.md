# Code regression catalog (Game Club Finance)

Severity if failed (`review-core` section 2): **S0** wrong money or data, a
club-isolation or security hole, a leak, a crash or a broken check; **S1** an
`AGENTS.md` invariant or a convention broken, or a real risk; **S2**
maintainability. Each case says how to check it. IDs are stable; append,
never renumber. `[cr YYYY-MM-DD]` marks a case added from a finding in that
run; `Fixed YYYY-MM-DD` plus the guarding test closes it.

## Run log (newest first; `retest` starts from the top row)

| Date | Commit | Scope | Findings (S0/S1/S2) | Checks run | Not run |
|---|---|---|---|---|---|

## SEC — secrets, auth, request safety

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| SEC-001 | S0 | Server-only secrets never reach client code | `grep -rn "SUPABASE_SERVICE_ROLE_KEY\|CRON_SECRET\|TELEGRAM_BOT_TOKEN" src --include=*.tsx --include=*.ts \| grep -v "src/lib/supabase/service.ts\|src/app/api\|src/lib/telegram"` | No hit in a `'use client'` module, component, fixture or `NEXT_PUBLIC_` name |
| SEC-002 | S0 | Cron routes check `CRON_SECRET` before any read | Read `src/app/api/cron/*/route.ts` | Every handler compares the bearer secret first and returns 401 before touching Supabase |
| SEC-003 | S0 | Server auth validates with `auth.getUser()` | `grep -rn "getSession()" src/app src/lib/supabase/server.ts` | No handler or server component trusts `getSession()` for identity; `auth.getUser()` decides |
| SEC-004 | S0 | The service client is used only in trusted server code | `grep -rln "supabase/service" src` | Only `src/app/api/cron`, `src/lib/telegram` and scripts import it; never a page or client component |
| SEC-005 | S0 | No secrets in the tree or history | `git grep -nE "sb_secret_\|service_role\|bot[0-9]{8,}:"` and `git log -S service_role --oneline` | Nothing committed; `.env*` ignored except an example with blanks; report location only |
| SEC-006 | S1 | API routes validate input and hide internals | Read each `src/app/api/**/route.ts` | Body parsed with explicit checks or a schema, 4xx on bad input, no stack trace or Supabase `details` in the response |
| SEC-007 | S1 | Logs carry no personal or financial data | `grep -rnE "console\.(log\|error\|warn)" src/app src/lib` | No tokens, chat ids with names, amounts or request bodies logged; ids and stage names at most |
| SEC-008 | S1 | Telegram delivery reads its token server-side only | `grep -rn "TELEGRAM" src/lib/telegram` | Token read from `process.env` inside transport code, never passed through a response or a client prop |

## SCOPE — club scoping and RLS

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| SCOPE-001 | S0 | Every club-owned read filters by the selected club | `grep -rn "\.from('" src --include=*.ts --include=*.tsx \| grep -v test` and read each query | Each query on a club-owned table carries `.eq('club_id', ...)` or calls an RPC that takes `p_club_id` |
| SCOPE-002 | S0 | Every club-owned write sets `club_id` from the selected club | Read each `.insert(`/`.upsert(`/`.rpc(` call on club tables | `club_id` comes from the selected club context, never from a form field or URL |
| SCOPE-003 | S0 | RLS is enabled on every club-owned table | `grep -niE "create table" migrations/*.sql` against `enable row level security` and `create policy` | Every table with `club_id` has RLS on and member-scoped policies; `docs/agents/database.md` lists them |
| SCOPE-004 | S0 | Policies mirror each other across sibling ledgers | Compare the policies of the current ledgers in `docs/agents/database.md` | Same membership check, same role gate for writes, no ledger with a looser policy |
| SCOPE-005 | S1 | UI hiding is not the only permission check | Read `src/lib/permissions.ts` and the RPC or policy behind each gated action | Viewer and admin limits are enforced by RLS or the RPC, not only by hiding a button |
| SCOPE-006 | S1 | Club switch invalidates in-flight data | Read the pages' effects that load on `clubId` change | A stale response from the previous club is ignored (abort or guard) so no cross-club flash |
| SCOPE-007 | S1 | Team and membership changes stay club scoped | Read `src/app/api/team/**` and `src/lib/supabase/clubScopedTeamAccess*` | Approve or reject only touches memberships of the caller's club; `clubScopedTeamAccess.test.ts` covers it |

## DATE — business dates

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| DATE-001 | S1 | No ad hoc today or month computation | `grep -rnE "new Date\(\)\.toISOString\(\)\.slice\|toISOString\(\)\.split\|getMonth\(\)" src --include=*.ts --include=*.tsx \| grep -v "src/lib/utils.ts\|test"` | No hit; callers use `todayIso`, `currentYearMonth`, `monthRange` from `src/lib/utils.ts` |
| DATE-002 | S1 | The business-day start hour is honoured | Read callers of `todayIso` and `businessDayDate` | The club's `businessDayStartHour` is passed where the club is known; `businessPeriod.test.ts` covers the boundary |
| DATE-003 | S1 | Server code uses the app time zone | `grep -rn "serverTodayIso\|APP_TIME_ZONE" src/app/api src/lib/telegram` | Cron and report code derive dates through `serverTodayIso`, never the server's local date |
| DATE-004 | S1 | Stored dates stay ISO | Read every date write to Supabase | Dates are written as `YYYY-MM-DD` strings from the pickers, never formatted display strings |
| DATE-005 | S1 | Ranges are inclusive and never invent future days | Read range builders and chart series code | `to` is inclusive; no series point after the business today |
| DATE-006 | S2 | No native date inputs | `grep -rn 'type="date"\|type="month"' src --include=*.tsx` | No hit; `DatePicker`/`MonthPicker` from PresentationFoundation are used |

## CALC — formulas and money

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| CALC-001 | S0 | Totals come from `src/lib/calculations` | `grep -rnE "reduce\((.*)=> .*\+" src/app src/components --include=*.tsx` | A summed amount in a component is a lead; the formula lives in `src/lib/calculations` with a test |
| CALC-002 | S0 | Accounting profit and cash-left stay separate | Read `src/lib/calculations/moneyDetails.ts`, `availableMoney.ts`, `ownerProfitSnapshot.ts` | Cash-left subtracts owner withdrawals and purchases; profit does not; neither is derived from the other |
| CALC-003 | S0 | Dashboard, money details and Telegram report derive the same numbers | Read `dashboardMetrics.ts`, `moneyDetails.ts`, `src/lib/telegram/*report*` | One calculation function per figure, called by every surface; no second code path |
| CALC-004 | S0 | No `Number()` on formatted money | `grep -rnE "Number\(\|parseFloat\(\|parseInt\(" src/app src/components --include=*.tsx` | Form values go through `parseCurrencyInput`; unit prices through `formatUnitCurrency` keep decimals |
| CALC-005 | S1 | Division and rounding are guarded | Read averages, margins and per-unit prices in `src/lib/calculations` | Zero denominators return 0 or null; rounding happens once at display, not inside sums |
| CALC-006 | S1 | Payment methods are normalized | `grep -rn "'cash'\|'terminal'\|'card'" src --include=*.ts --include=*.tsx \| grep -v paymentMethods` | Literal methods appear only through `normalizePaymentMethods`/`defaultPaymentMethod` in `src/lib/paymentMethods.ts` |
| CALC-007 | S1 | Deactivated staff are excluded from salaries due | Read `src/lib/calculations/salaries.ts` and its test | Total due counts active staff only; `salaries.test.ts` has a deactivated case |
| CALC-008 | S1 | Every calculation module has edge-case tests | `ls src/lib/calculations/*.ts \| grep -v test` vs `*.test.ts` | Each module has a test covering empty input, month boundary, zero stock or partial payment where relevant |

## RPC — atomic operations and ledgers

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| RPC-001 | S0 | Inventory purchases use the atomic RPC | Read `src/app/(dashboard)/stock-purchase` and `src/lib/supabase/*stock*` | One `.rpc(` call per purchase; no insert-then-update pair from the browser |
| RPC-002 | S0 | Closing stock uses the atomic RPC | Read `src/app/(dashboard)/closing-stock` and `closingStockQueries.ts` | Counts are saved through the RPC; saved snapshots are never recomputed from later purchase edits |
| RPC-003 | S0 | Club creation and owner withdrawals use their RPCs | `grep -rn "\.rpc('" src \| grep -i "club\|withdraw\|owner"` | Both flows call the established RPC; no multi-table browser writes |
| RPC-004 | S0 | Debts and payments are append-only | `grep -rn "\.update(\|\.delete(" src \| grep -i debt` | No update or delete on `debts` or debt payments from the app; a payment insert updates the parent in the database |
| RPC-005 | S0 | Retired tables have no live writers | `grep -rn "income_transactions\|expense_transactions\|cash_movements" src scripts` | Only reads for history; no `.insert`, `.update` or `.delete` |
| RPC-006 | S1 | Writes that a double click can repeat are idempotent or atomic | Read save handlers for income, expense, salary and debt forms | Button disabled while pending and one write per submit; an RPC where several tables change |
| RPC-007 | S1 | RPCs share the sibling shapes and hardening | `grep -n "security definer\|search_path" migrations/*.sql` | New RPCs take `p_club_id`, set `search_path`, and check membership like the existing ones |

## MIG — migrations and schema

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| MIG-001 | S0 | Applied migrations are never edited | `git diff --stat HEAD~20 -- migrations/ \| grep -v "^ migrations/0[89][0-9]"` on a review | Only new, uniquely numbered files change; `src/lib/supabase/migrationManifest.json` lists the new one |
| MIG-002 | S0 | Migration numbers are unique and ordered | `ls migrations \| cut -d_ -f1 \| sort \| uniq -d` | No duplicate prefix; the manifest matches the directory |
| MIG-003 | S1 | Compatibility fallbacks are kept | Read any removed `catch` or feature probe around a newer column or RPC | A fallback is removed only when the task proves every deployed database is migrated (invariant 8) |
| MIG-004 | S1 | New club-owned tables follow the ledger shape | Read the new `create table` | `id uuid`, `club_id` FK to `clubs`, business `date`, `created_at`, `created_by default auth.uid()`, money as `numeric`, RLS, `(club_id, date)` index |
| MIG-005 | S1 | Each new migration has a test | `ls src/lib/supabase/*Migration.test.ts` vs the newest `migrations/*.sql` | A test reads the SQL and asserts the objects it creates, like `costAndIndexCleanupMigration.test.ts` |
| MIG-006 | S1 | Indexes cover the queries the app runs | For each `.eq('club_id').gte('date')...order(` query, find its index in the migrations | A `(club_id, date)` or matching composite index exists; no index that nothing queries |
| MIG-007 | S2 | One TypeScript row type per table | Read `src/types/index.ts` against the migrations | No second type for the same table; fields match columns and nullability |

## I18N — translations

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| I18N-001 | S1 | The three message files share one shape | `node -e` script diffing the key trees of `src/messages/{en,ru,uz}.json` | Identical key sets; same placeholders per key |
| I18N-002 | S1 | No user-facing literal strings in JSX | `grep -rnE ">[A-Za-zА-Яа-я][^<{]{3,}<" src/app src/components --include=*.tsx \| grep -v test` | Every visible string goes through `next-intl`; hits are only non-copy (units, symbols) |
| I18N-003 | S1 | Every used key exists | Compare `t('...')` keys in `src` with `en.json` | No raw message id rendered; no unused key left behind after a change |
| I18N-004 | S2 | Dates and money use the app locale | `grep -rn "toLocaleString\|toLocaleDateString\|toFixed(" src --include=*.tsx` | No hit outside `src/lib/formatters.ts` |

## FMT — formatting conventions

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| FMT-001 | S1 | Money inputs format while typing | Read every amount field | `CurrencyInput` or `formatCurrencyInput` on change and `parseCurrencyInput` on save; thousands separators shown |
| FMT-002 | S1 | Totals use `formatCurrency` | `grep -rn "UZS\|сум\|so'm" src --include=*.tsx \| grep -v formatters` | No hand-built money strings; unit prices use `formatUnitCurrency` |
| FMT-003 | S1 | Dates render through formatters | `grep -rn "formatDate\|formatYearMonth" src --include=*.tsx \| wc -l` vs raw ISO strings in JSX | No raw `YYYY-MM-DD` shown to the user |
| FMT-004 | S2 | Tabular numbers in money columns | Read `Money.tsx` and `DataTable` money cells | `tabular-nums` applied so columns align |

## UI — design-system use

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| UI-001 | S1 | No raw elements outside PresentationFoundation | `grep -rnE "<(button\|input\|select\|textarea\|table\|dialog)([ >]\|$)" src/app src/components --include=*.tsx \| grep -v PresentationFoundation` | No hit; `Button`, `Field`+`Input`, `DataTable`, `Modal` used |
| UI-002 | S1 | No `window.confirm` or `alert` | `grep -rn "window\.confirm\|window\.alert\|alert(" src --include=*.tsx` | No hit; `useConfirm` and `useToast` are used |
| UI-003 | S1 | No global `.btn-*`, `.input-field`, `.card` classes | `grep -rn "btn-\|input-field\|\"card\"\|'card'" src --include=*.tsx src/app/globals.css` | No reintroduced global classes |
| UI-004 | S1 | Colours only from theme tokens | `grep -rnE "#[0-9a-fA-F]{3,8}\b\|bg-white\|text-black\|-(red\|green\|blue\|slate\|zinc)-[0-9]" src/app src/components --include=*.tsx` | No hit outside third-party brand marks |
| UI-005 | S1 | Every page has loading, empty and error states | Read each `*Page.tsx` | `Skeleton` while loading, `EmptyState` when no data, `InlineAlert`/`LoadErrorAlert` with retry on error |
| UI-006 | S2 | Foundation components stay generic | `grep -rn "supabase\|useTranslations\|Club" src/components/PresentationFoundation` | No Supabase call, domain copy or club type inside a foundation component |

## NET — network and data fetching

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| NET-001 | S1 | Independent queries run in parallel | Read each page's load effect | Independent awaits are wrapped in `Promise.all`; no serial waterfall |
| NET-002 | S1 | No query inside a loop or per row | `grep -rn "await" src/app src/components --include=*.tsx \| grep -B3 "map(\|for (" ` | No N+1; one query per table per load |
| NET-003 | S1 | Reads past 1,000 rows use `fetchAllRows` | Read every unbounded ledger read that feeds a total | `fetchAllRows` from `src/lib/supabase/pagination.ts` or an aggregate RPC |
| NET-004 | S1 | Supabase errors are checked | `grep -rn "const { data" src --include=*.ts --include=*.tsx \| grep -v error` | Every result checks `error` and surfaces it; no silent `data ?? []` on failure |
| NET-005 | S1 | Fast range or club switches cannot race | Read load effects for a cancelled flag or abort | The last selection wins; stale responses are dropped |
| NET-006 | S1 | Narrow `select` lists | `grep -rn "select('\*')" src` | No `*` on wide tables; only the columns the reader uses |
| NET-007 | S2 | No refetch on focus or interval without need | `grep -rn "setInterval\|visibilitychange\|refetchOnWindowFocus" src` | Each one is justified by data that actually changes at that rate |

## PERF — performance

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| PERF-001 | S1 | No O(n²) over row sets | `grep -rn "\.filter(" src/lib/calculations src/components \| grep -B2 "\.map("` | Rows indexed once in a `Map` keyed by date or id |
| PERF-002 | S1 | Heavy libraries load lazily | `grep -rn "from 'recharts'\|from 'xlsx'\|from 'jspdf'" src/app src/components` | Charts and exporters are behind `dynamic()` or `import()` |
| PERF-003 | S1 | Aggregation in SQL where rows only feed a total | Read reads whose result is reduced to one number | An RPC, view or `count`/`sum` call instead of downloading every row |
| PERF-004 | S2 | `useMemo` and `useCallback` where they measurably help | Read memo usage in large pages | Expensive derivations memoized; no reflex memoization of cheap values |
| PERF-005 | S2 | Context values do not re-render the whole tree | Read `src/components/layout/*` providers | Context value memoized; frequently changing state kept local |

## DRY — reuse and unified logic

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| DRY-001 | S1 | One implementation per use case | List record income, expense, purchase, closing stock, debt payment, owner withdrawal, salary, daily report, club switch; find every implementer | One `src/lib` function per use case; pages, API routes and Telegram call it |
| DRY-002 | S1 | The same query is not written twice with different selects | `grep -rn "\.from('<table>')" src` for each ledger | One helper in `src/lib/supabase` per read shape |
| DRY-003 | S1 | Loading/error/refetch boilerplate is shared | Diff the state handling of two sibling pages (Debts vs Money taken) | A shared hook or helper; no copy-pasted state machine |
| DRY-004 | S2 | Repeated markup becomes a foundation component | Three or more elements with the same classes in two files | Extracted into `src/components/PresentationFoundation` with a `variant` |
| DRY-005 | S2 | Formatting helpers are not re-implemented | `grep -rn "Intl.NumberFormat\|Intl.DateTimeFormat" src \| grep -v formatters` | Only `src/lib/formatters.ts` builds formatters |

## SOLID — structure

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| SOLID-001 | S2 | A component does not fetch, calculate and render at once | Read `*Page.tsx` files over 400 lines | Queries in a hook or helper, formulas in `src/lib/calculations`, the page composes |
| SOLID-002 | S2 | No boolean flag per new caller | `grep -rnE "if \(page === \|variant === '" src/components` | Composition or a config map instead of growing conditionals |
| SOLID-003 | S2 | Wrappers keep the wrapped contract | Read wrappers in PresentationFoundation | `className`, `aria-*` and `ref` are forwarded |
| SOLID-004 | S2 | UI is not coupled to table shapes | `grep -rn "from('" src/components src/app --include=*.tsx` | Components call typed helpers in `src/lib/supabase`, not the client directly |

## YAGNI — unused and speculative code

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| YAGNI-001 | S2 | No unused exports, props or translation keys | `npx tsc --noEmit` plus `grep` per suspect export across `src scripts migrations docs` | Each unused item is deleted, except migration fallbacks (invariant 8) |
| YAGNI-002 | S2 | No single-caller abstraction without payoff | Find helpers with one import site | Inlined unless it removes duplication or enables a test |
| YAGNI-003 | S2 | No option every caller sets the same way | Read parameters and boolean props | The constant value is hard-coded and the option removed |
| YAGNI-004 | S2 | No leftover debug code | `grep -rn "console.log\|TODO\|FIXME\|debugger" src` | No hit in committed code |

## COST — Supabase and Vercel cost

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| COST-001 | S1 | Cron jobs fetch each ledger once per run | Read `src/lib/telegram/sendDailyFinanceReport.ts` and the cron routes | One snapshot shared by every section; retries reuse the stored report where possible |
| COST-002 | S1 | No `count: 'exact'` on large tables | `grep -rn "count: 'exact'" src` | `estimated` or no count unless the exact number is shown |
| COST-003 | S1 | Dashboard bootstrap stays one round trip | Read `src/lib/supabase/dashboardBootstrap.ts` | One RPC or snapshot feeds the dashboard; no per-card queries |
| COST-004 | S2 | Payloads carry only used columns | Compare each `select` with the fields the reader touches | No unused columns; no JSON blobs that only feed a total |

## DB — database shape and queries

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| DB-001 | S1 | No parallel ledger for one concept | Read new tables against `docs/agents/database.md` | A new payments, entries or movements table reuses or extends the existing ledger |
| DB-002 | S1 | Same domain value, same spelling everywhere | `grep -n "check (" migrations/*.sql \| grep -i "payment_method\|role\|unit"` | Enum values agree across tables, migrations and `src/lib/paymentMethods.ts`/`permissions.ts` |
| DB-003 | S1 | Filters do not defeat the index | Read `.or(`, `.ilike(` and function-wrapped columns in queries | No `ilike '%x%'` or `or()` across columns on large tables without a matching index |
| DB-004 | S1 | Latest-row reads carry a `limit` | `grep -rn "\.order(" src \| grep -v "limit\|range"` | Reads that need the newest row use `.limit(1)` |
| DB-005 | S2 | Money is `numeric`, ids are `uuid`, dates are `date` | `grep -nE "float\|double precision\|text primary key" migrations/*.sql` | No money in `float`, no `text` ids on new tables |

## TEST — verification

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| TEST-001 | S0 | The four checks pass | `npm run typecheck && npm run lint && npm test && npm run build` | All green; any failure is quoted as a finding |
| TEST-002 | S1 | The change-to-test matrix is real | Read `docs/agents/testing.md` rows | Every named test file exists and exercises what the row claims |
| TEST-003 | S1 | New logic has a behavioural test | For each changed `src/lib` function, find its test | A test with an input and an expected business result, not an implementation snapshot |
| TEST-004 | S2 | Slow suites are known | Time `ledgerReadPermissions.test.ts` | Runtime noted; pre-commit hook still runs what it claims |
