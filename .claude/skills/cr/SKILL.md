---
name: cr
description: Deep code review of the uncommitted diff, a commit range, a branch or a PR in Game Club Finance. Checks correctness, financial logic, club scoping/RLS, migrations, i18n, formatting, design-system use, network and data fetching, performance, cleanup, DRY and SOLID. Use when the user types /cr.
argument-hint: "[empty = uncommitted diff | commit | A..B | branch | PR number] [fix]"
disable-model-invocation: true
---

# /cr: code review

Target: `$ARGUMENTS`.

- Empty: uncommitted changes (`git diff HEAD` plus untracked files).
  If the tree is clean, review the last commit.
- A commit, `A..B` range, or branch: `git diff` against it.
- A number: the GitHub PR (`gh pr view <n>`, `gh pr diff <n>`).
- If the arguments contain `fix`, apply the confirmed fixes after the review.
  Otherwise review only.

Read every changed file in full, not just the hunks, plus the callers and
callees of every changed function. Report only findings you have verified in
the code. Give each one a concrete failure scenario (inputs or state, then the
wrong result). No style nitpicks that lint already enforces.

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

## Report

```
CR: <target>   Verdict: APPROVE | APPROVE WITH NITS | CHANGES REQUESTED

Findings (most severe first)
1. [Blocker|Major|Minor|Nit] file:line: <defect in one sentence>
   Scenario: <inputs or state → wrong result>
   Fix: <concrete change>

Checked and fine: <risky areas verified, incl. network, performance, DRY/SOLID>
Checks run: <commands and results>
```

**Blocker** = wrong money/data, a security or club-isolation hole, data loss,
or a broken build. With `fix`: apply the fixes, re-run the checks, then report
what changed. Do not commit unless asked.
