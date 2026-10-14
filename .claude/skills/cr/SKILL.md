---
name: cr
description: Deep code review of the uncommitted diff, a commit range, a branch or a PR in Game Club Finance. Checks correctness, financial logic, club scoping/RLS, migrations, i18n, formatting rules and design-system use against AGENTS.md. Use when the user types /cr.
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

### 6. Simplicity and performance

Duplicated logic that an existing helper already covers, needless re-renders or
queries, O(n²) filters over large row sets, oversized client bundles (charts
should stay dynamically imported).

## Report

```
CR: <target>   Verdict: APPROVE | APPROVE WITH NITS | CHANGES REQUESTED

Findings (most severe first)
1. [Blocker|Major|Minor|Nit] file:line: <defect in one sentence>
   Scenario: <inputs or state → wrong result>
   Fix: <concrete change>

Checked and fine: <short list of risky areas you verified>
Checks run: <commands and results>
```

**Blocker** = wrong money/data, a security or club-isolation hole, data loss,
or a broken build. With `fix`: apply the fixes, re-run the checks, then report
what changed. Do not commit unless asked.
