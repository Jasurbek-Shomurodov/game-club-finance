---
name: cr
description: Deep code review of Game Club Finance. With no arguments it audits the whole app (full test suite, database performance and models, reuse and use cases, SOLID, DRY, YAGNI). With a target it reviews that diff, commit range, branch or PR for correctness, financial logic, club scoping/RLS, migrations, i18n, formatting, design-system use, network and data fetching, performance, cleanup, DRY and SOLID, and cost, Supabase and database shape. Use when the user types /cr or cr.
argument-hint: "[empty = full | diff | commit | A..B | branch | PR number | path | area] [fix]"
disable-model-invocation: false
---

# /cr: code review

> **Shared contract.** Load the `review-core` skill first (`~/.claude/skills/review-core/SKILL.md`). Its ground rules, argument
> grammar, S0/S1/S2 severity scale, report skeleton, fix mode and fan-out
> apply here. This file adds only what is specific to Game Club Finance.

Target: `$ARGUMENTS` (grammar in `review-core` section 1).

- **Empty, `full`, or `cr` alone: full-app audit.** Follow the "Full-app
  audit" section below, then run review passes 1 to 9 over the whole
  codebase, not a diff.
- `diff`: uncommitted changes (`git diff HEAD` plus untracked files).
  If the tree is clean, review the last commit.
- A commit, `A..B` range, or branch: `git diff` against it.
- A number: the GitHub PR (`gh pr view <n>`, `gh pr diff <n>`).
- A path or glob: those files plus their direct imports and callers.
- If the arguments contain `fix`, apply the confirmed fixes after the review
  (`review-core` section 4). Otherwise review only.

For a diff target, read every changed file in full, not just the hunks, plus
the callers and callees of every changed function. Report only findings you
have verified in the code. Give each one a concrete failure scenario (inputs
or state, then the wrong result). No style nitpicks that lint already enforces.

## Full-app audit (no arguments)

The whole repository is the target. Read `AGENTS.md`, `docs/agents/*.md` and
`src/components/PresentationFoundation/README.md` first, then walk `src/app`,
`src/components`, `src/lib`, `migrations` and `scripts`. Use subagents to
split the sweep by area (pages and routes, lib and calculations, Supabase and
migrations, Telegram) and merge their verified findings; every finding still
needs a file, a line and a scenario you checked yourself.

### A. Full testing

Run the complete verification set and treat any failure as S0:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Then audit coverage, not just the pass/fail:

- Map every module under `src/lib` to its `*.test.ts`. Name the pure
  functions, calculations, Supabase helpers and Telegram renderers with no
  test or with tests that skip edge cases (empty ranges, month boundaries,
  business-day boundary, zero stock, partial payments, deactivated staff,
  missing migrations).
- Check the change-to-test matrix in `docs/agents/testing.md` against the
  repo: each row's named test file must exist and exercise what it claims.
- Flag tests that only assert the code does what it does (snapshot of an
  implementation detail) instead of the business rule.
- Note slow or flaky suites (`ledgerReadPermissions.test.ts` on embedded
  PostgreSQL) and whether they run in the pre-commit hook.

### B. Database performance

Read `docs/agents/database.md` and every file in `migrations` in order.
Build the effective schema (tables, columns, indexes, RLS policies, RPCs,
triggers) and compare it with how `src/lib/supabase` and the pages query it:

- For every query in the app, name the index it uses. Report queries on
  club-owned tables with no `(club_id, ...)` index that covers their filter
  and order, and indexes that nothing queries.
- RLS policies that run a subquery per row (`EXISTS (select ... from
  club_members ...)`) without a supporting index, or that differ between
  sibling ledgers.
- RPCs and triggers that loop row by row where a set-based statement would
  do, or that are missing `security definer` / `search_path` hardening where
  the sibling RPCs have it.
- Reads that download whole ledgers to aggregate in JavaScript; writes that
  take several round trips where one RPC exists or should.
- Tables with no `created_at`, no primary key, `text` ids, or money stored as
  `float`.

### C. Database models

One concept, one table, one TypeScript type:

- List every table and the `src/types` row type that maps to it. Report
  tables with two or more row types, types with fields the table does not
  have, and hand-written types that drift from the migrations.
- Report parallel ledgers or columns for one concept (two "payments"
  shapes, `*_at` next to `*_date` for the same event, `comment` vs `note`,
  payment methods stored with different spellings).
- Check the retired tables (`income_transactions`, `expense_transactions`,
  `cash_movements`) have no live writers, and that every current ledger
  follows the same `id`, `club_id`, business `date`, `created_at`,
  `created_by` shape with matching types, defaults and nullability.
- Check enums and check constraints for the same domain value (payment
  method, role, product unit) agree across tables, migrations and
  `src/lib/paymentMethods.ts` / `src/lib/permissions`.

### D. Code reuse and unified logic (use cases)

Find the same business operation implemented more than once and name the one
home it should have:

- Enumerate the app's use cases (record income, record expense, record a
  purchase, count closing stock, pay a debt, withdraw owner money, pay
  salary, build the daily report, switch club, change date range). For each
  one list every place that implements part of it (page, modal, API route,
  Telegram report, script). Two implementations of one use case is a
  finding; the fix is a single function in `src/lib` (calculations,
  supabase helper, or a `useCases`/service module) that every caller uses.
- Formulas: any total, profit, cash-left, stock value or debt balance
  computed outside `src/lib/calculations`.
- Queries: the same table read with slightly different `select` lists or
  filters in several components; `fetchAllRows` applied in some callers and
  forgotten in others.
- Formatting and dates: money or dates formatted outside `src/lib/formatters.ts`
  and `src/lib/utils.ts`.
- UI: bespoke markup or state machines that `@/components/PresentationFoundation`
  already provides (forms, modals, confirms, tables, pickers, skeletons).
- Hooks and state: copy-pasted loading/error/refetch boilerplate across
  pages that one data hook should own.
- Telegram and dashboard: the daily report and the dashboard must derive
  the same numbers from the same calculation functions, never from two
  code paths.

### E. SOLID, DRY and YAGNI

Apply pass 8 to the whole tree, plus **YAGNI**:

- Code, props, options, columns, translation keys, feature flags, env vars,
  migrations fallbacks and scripts that nothing uses or that exist for a
  future that never came. Confirm with `grep` across `src`, `scripts`,
  `migrations` and `docs` before reporting; each one is S2 with the
  deletion as the fix.
- Abstractions with one caller that add indirection without removing
  duplication (a generic helper used once, a provider wrapping one page).
- Configurable behaviour (parameters, boolean props, generics) that every
  caller sets the same way.
- Migration compatibility fallbacks are an exception: keep them unless the
  user has proved every deployed database is migrated (invariant 8).

Group DRY and SOLID findings by the refactor that fixes them (for example
"move X, Y and Z into `src/lib/calculations/owner.ts`") rather than listing
every duplicate separately, so the report reads as a plan.

### Audit report

Use the report format below with `CR: full app`. Add, before the findings:

```
Checks: typecheck <pass|fail>, lint <pass|fail>, test <n passed, n failed>,
        build <pass|fail>
Coverage gaps: <modules with no or weak tests>
Schema: <tables> tables, <indexes> indexes, <RPCs> RPCs, <policies> policies;
        <n> queries without a covering index
```

Then the ranked findings, then a "Refactor plan" section that orders the
reuse/SOLID/DRY/YAGNI work by payoff and risk, each item with the files it
touches and the tests that must stay green. With `fix`, apply only S0 and
S1 items that are mechanical and safe, re-run the four checks, and leave
the refactor plan for the user to approve.

## Review passes

### 1. Intent

What was the change meant to do (commit message, PR body, user request)? Does
the code actually do it, completely? Look for leftovers: dead code, unused
exports or translations, TODOs, debug logs.

### 2. Correctness and logic

- Off-by-one errors and ranges (inclusive `to`), empty arrays, `null`/`undefined`
  from Supabase, `Number()` on strings, NaN, division by zero, rounding.
- React: stale closures, missing effect dependencies, state updates after
  unmount, keys, race conditions between fast range or club switches,
  hydration mismatches (`new Date()` during render).
- Async: unhandled rejections, missing `error` checks on Supabase results,
  partial failure leaving the UI inconsistent.

### 3. Project invariants (`AGENTS.md`, non-negotiable)

1. Every club-owned read and write is filtered by the selected `club_id`. RLS
   is the real boundary; UI hiding is not.
2. Business dates come from `todayIso`, `currentYearMonth` and the other
   helpers in `src/lib/utils.ts`, never ad hoc UTC dates.
3. Formulas come from `src/lib/calculations`. Accounting profit is kept apart
   from cash-left.
4. Inventory, closing stock, club creation and owner withdrawals use the
   atomic RPCs, not several browser writes.
5. Debts and debt payments are append-only.
6. Saved stock counts are not recomputed.
7. No writes to the retired `income_transactions`, `expense_transactions` or
   `cash_movements`.
8. Migration fallbacks are kept.
9. A new migration file per database change; applied migrations are never edited.
10. `en.json`, `ru.json` and `uz.json` change together with matching shapes.
11. No service-role key, `CRON_SECRET` or Telegram token in client code,
    logs or fixtures.

Also: `fetchAllRows` where results can exceed 1,000 rows; server auth uses
`auth.getUser()`; the correct Supabase client (browser, server or service);
payment methods normalized through `src/lib/paymentMethods.ts`.

### 4. Formatting and UI conventions

- Money via `formatCurrency`, `formatCurrencyInput`/`parseCurrencyInput` and
  `formatUnitCurrency`. No raw numbers and no `Number()` on formatted strings.
- Dates via `src/lib/formatters.ts` and `DatePicker`/`MonthPicker`. No native
  date inputs.
- UI from `@/components/PresentationFoundation`. No bespoke button, field or
  card markup, no `window.confirm`, no global `.btn-*` or `.card` classes.
- Colours only from theme tokens (`text-gray-*`, `bg-surface`, `rgb(var(--c-*))`).
  Hard-coded hex or white breaks dark mode.
- Every visible string goes through `next-intl`.

### 5. Tests

Do the tests cover the new logic and its edge cases? Run them:

```bash
npx vitest run <changed or related tests>
npm run typecheck && npm run lint
```

Run `npm test` and `npm run build` for financial, auth, migration or
cross-route changes. A failing check is a finding.

### 6. Network and data fetching

For every Supabase query, RPC, `fetch` and API route the change touches or
calls:

- **Waterfalls**: independent queries awaited one after another instead of
  `Promise.all`; a client fetch that could be server-rendered or preloaded.
- **N+1 and duplicates**: queries inside loops or per row or card, the same
  data fetched by sibling components, refetching on every render or focus.
- **Payload**: `select('*')` or unused columns, missing date/`club_id` filters
  that pull extra rows, missing `fetchAllRows` past 1,000 rows, large JSON sent
  to the client that only feeds a total.
- **Races and staleness**: no abort/ignore of a stale response when the club or
  range changes fast; cache or snapshot reuse past its freshness; optimistic
  UI that is never rolled back.
- **Failure handling**: unchecked `error`, no retry or error state, partial
  writes. Writes must be idempotent or atomic (RPC) where a double click or
  retry can repeat them.
- **API routes**: auth via `auth.getUser()`, input validation, correct status
  codes, no secrets or stack traces in responses, and cron/Telegram endpoints
  protected by `CRON_SECRET`.

If the app is reachable, confirm the suspicion with `read_network_requests`
(request count, order, timing, size) rather than guessing.

### 7. Performance

- Expensive derivations recomputed every render (`useMemo` where it measurably
  helps; not by reflex), unstable props or callbacks that defeat memoized
  children, context values that re-render the whole tree.
- O(n²) work over row sets (`filter` inside `map` per day). Index once with a
  `Map`.
- Long lists or tables rendered in full where pagination or virtualization is
  needed.
- Client bundle: heavy libraries (charts, xlsx, date libs) imported statically
  into routes that rarely need them. Charts stay `dynamic()`; `'use client'`
  only where interactivity requires it.
- Work that belongs on the server or in the database (aggregation in SQL/RPC
  instead of downloading every row to sum in the browser).

### 8. Cleanup, DRY and SOLID

**Cleanup**: unused imports, variables, exports, props, CSS and translation
keys; commented-out code; stale comments that no longer match the code;
misleading names; leftover `console.log`; files or components that grew past
one clear purpose.

**DRY**: the same markup, formula, query or formatting repeated in two or more
places. Point to the existing helper to reuse, or name the shared home for a new
one: `@/components/PresentationFoundation` for UI, `src/lib/calculations` for
formulas, `src/lib/supabase` for queries, `src/lib/formatters.ts` for
formatting. Do not merge code that only looks alike but changes for different
reasons.

**SOLID** (in React/TypeScript terms; only report it when it causes a real
cost):
- *Single responsibility*: a component that fetches, calculates and renders at
  once. Move formulas to `src/lib/calculations` and queries to a helper or hook.
- *Open/closed*: a component or function that needs another boolean flag or
  `if (page === ...)` for every new caller. Prefer composition (children,
  slots, render props) or a config map.
- *Liskov/interface segregation*: props interfaces that force callers to pass
  things they do not use; wrappers that break the contract of the component
  they wrap (for example dropping `className`, `aria-*` or `ref`).
- *Dependency inversion*: UI coupled directly to table shapes or the Supabase
  client where a typed query helper or RPC should sit in between, which makes
  it untestable.

Every finding here needs a concrete cost (a bug risk, duplicated maintenance,
a measurable slowdown, or blocked testing), plus the smallest refactor that
removes it. Skip pure taste.

### 9. Cost, Supabase and database

Review every query, RPC, migration and schema change the diff touches for
what it costs to run and to maintain. Read `docs/agents/database.md` and the
migrations a change depends on before reporting.

**Cost** (Supabase and Vercel bill by egress, compute and invocations):
- Rows and bytes that leave the database only to be summed, counted or
  filtered in the browser or in a route handler. Prefer an RPC, a view or an
  aggregate (`count`, `sum`) so only the result travels.
- Polling, refetch-on-focus or interval refreshes that re-run heavy reads when
  nothing changed; cron jobs that run more often than the data moves.
- `count: 'exact'` on large tables where `'estimated'` or no count would do;
  `select('*')` on wide tables; JSON payloads that carry columns no reader
  uses.
- Server routes and Telegram/cron jobs that fetch the same ledgers twice in
  one run instead of sharing a snapshot.

**Database shape** (keep similar things the same):
- A new table or column that duplicates a concept the schema already has
  (another "payments"/"entries"/"movements" ledger, a second `payment_method`
  or `comment` spelling, parallel `*_at` and `*_date` columns for one event).
  Reuse the existing ledger or extend it; name the matching table.
- Columns, enums and check constraints for the same concept must match across
  tables: the same type (`numeric` for money, `date` for business dates,
  `uuid` for ids), the same nullability, the same defaults
  (`created_by default auth.uid()`), the same `club_id` + `created_at` shape.
- Every club-owned table needs `club_id` with an index that covers the
  queries the app runs (`(club_id, date)` for ledgers), a foreign key to
  `clubs`, and RLS policies that mirror the sibling tables.
- RPC inputs and outputs should share the shapes of existing RPCs
  (`p_club_id`, `p_date`, snapshot payloads) so the TypeScript types in
  `src/types` and the query helpers in `src/lib/supabase` stay unified.
- One TypeScript model per table: do not add a second row type for the same
  table with slightly different fields; extend the existing one or `Pick`
  from it.

**Query plan**: filters that defeat an index (functions on the indexed
column, `or()` across columns without a matching index, `ilike '%x%'` on
large tables), missing `limit` on reads that only need the latest row,
`order` on an unindexed column, and migrations that add an index without
`concurrently` on a large live table.

Report each finding with the measured or estimated cost (rows, bytes,
requests per page view or per cron run) and the smallest change: a new RPC,
a reused table, an index, or a narrower `select`.

## Report

Use the skeleton from `review-core` section 3 (`CR: <target | full app>`,
commit, checks, findings as `[S0|S1|S2]` with Scenario, Fix and Verified,
then Suggestions, Checked not a finding, Not run). Under "Checked, not a
finding" name the risky areas you verified: network, performance, DRY/SOLID,
cost and database.

Severity here: **S0** = wrong money or data, a security or club-isolation
hole, data loss, or a broken build or check. **S1** = an `AGENTS.md`
invariant or a convention above broken, or a real risk (race, unbounded read,
duplicated financial rule). **S2** = cleanup and maintainability. With
`fix`: `review-core` section 4, re-run the checks, then report what changed.
Do not commit unless asked.
