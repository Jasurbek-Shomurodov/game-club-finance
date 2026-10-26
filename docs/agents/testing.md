# Testing guide

Start narrow for fast feedback, then broaden according to the affected risk.

## Commands

```bash
# One relevant file
npx vitest run src/lib/calculations/stock.test.ts

# Standard full checks
npm run lint
npm run typecheck
npm test
npm run build

# What CI runs: the tests under coverage, checked against scripts/coverage-floor.json
npm run test:coverage
```

`npm test` runs Vitest in the Node environment. Tests are colocated as
`*.test.ts` or `*.test.tsx` near the behavior they protect.

`npm install` sets `core.hooksPath` to `.githooks`. Both hooks check a temporary
copy of exactly what is committed or pushed (`.githooks/snapshot.sh`), so other
uncommitted work in the tree neither fails nor passes them:

- `pre-commit`: typecheck, lint, and `npm run test:coverage` with the coverage
  floor (about a minute).
- `pre-push`: `npm audit --omit=dev --audit-level=high`, then
  `npm run test:e2e:full` on the pushed commit when the push changes `src/`,
  `migrations/`, `e2e/` or the build setup (about two minutes; docs- and
  scripts-only pushes skip it).

Together they cover every CI step. `--no-verify` bypasses them only in an
emergency. After a push, `npm run ci:watch` waits for that commit's
"Project checks" run and prints the failed steps if it goes red; fix a red run
before anything else.

## CI and the coverage floor

`.github/workflows/checks.yml` runs on every push and pull request: `npm ci`,
`npm audit --omit=dev --audit-level=high`, typecheck, lint, `npm run
test:coverage`, and the production build with placeholder Supabase values; a
second job, `e2e`, runs the browser P0 suite described below.
`test:coverage` runs the whole suite under v8 coverage (the PGlite tests need no
system package) and then `scripts/check-coverage-floor.mjs` compares
`coverage/lcov.info` with `scripts/coverage-floor.json`: the job fails when line,
branch or function coverage drops below the recorded floor, or when a
`src/lib` file that no test runs is missing from the `untested` list. The
percentages measure all of `src`; the per-file list covers only `src/lib`,
where business logic belongs, so new pages and view components need no entry. The floor only rises:
when the script reports that coverage is above the floor or that a listed file
is now tested, raise the numbers or shorten the list in the same change as the
new tests. A high or critical audit finding in a shipped dependency also fails
the job; fix it by updating the dependency, not by relaxing the audit.

## Browser P0 suite (Playwright on a fake Supabase)

```bash
npm run test:e2e:full   # production build pointed at the fake, then the suite
npm run test:e2e        # the suite alone, when e2e/build.mjs already ran
```

`e2e/` holds a Playwright suite of the S0 core flows (`e2e/p0.spec.mjs`:
sign-in and redirect, dashboard totals, a cash entry edit, an expense, a stock
purchase and a closing count through the atomic RPCs, a debt and its payment,
club isolation, viewer refusals, a language switch, a phone-width smoke). It
runs against `e2e/fake-supabase.mjs`, a small HTTP server that loads the whole
`migrations/` chain into PGlite and answers the PostgREST and GoTrue calls the app
makes, setting the request role and JWT claims the way Supabase does so RLS,
triggers and RPCs run for real. `e2e/fixture.mjs` seeds two clubs, an owner, an
admin and a viewer and one business day of ledgers with the expected totals
worked out in the file; tests compare the screen with those numbers, never with
each other. `playwright.config.mjs` starts the fake and `next start` on their own
ports (5156 and 54330), with every key from the local env files blanked, so a run
never reaches a real service. The `e2e` job in `.github/workflows/checks.yml`
runs it on every push and uploads the Playwright report when it fails.

A reproducible S0 finding from `/qa` gets a test here together with its fix, and
its catalog case is tagged `[e2e]` in `.claude/skills/qa/references/cases.md`.

## Change-to-test matrix

| Change | Minimum focused coverage | Full checks? |
|---|---|---|
| Pure calculation | Matching calculation test | Yes for financial formulas |
| Closing stock/import | `stock.test.ts`, `closingStock.test.ts` | Yes |
| Product purchase/write | `productWrites.test.ts`, stock tests | Yes |
| Dashboard range/totals | dashboard calculation/snapshot tests | Yes |
| Debt validation | debt and validation tests | Yes |
| Permissions/feature access | `permissions.test.ts` plus affected route | Yes |
| Startup/auth routing | `dashboardBootstrap.test.ts`, `src/proxy.test.ts`, signed-in reload/navigation | Yes |
| Supabase fallback/pagination | matching `src/lib/supabase` tests | Usually |
| Migration/RLS/RPC | `migrationFiles.test.ts` plus domain tests | Yes |
| Ledger read policy performance | `ledgerReadPermissions.test.ts` (embedded PostgreSQL) | Yes |
| Telegram report formatting | daily report/image tests | Yes |
| Telegram transport/ledger/cron | delivery, send, route, migration tests | Yes |
| Locale-only copy | JSON shape review, typecheck/build | Build recommended |
| Styling isolated to one component | lint/typecheck and visual check | Risk-based |

Run the full four checks for financial, authorization, migration,
configuration, cron, cross-route, or shared-type changes.

## Manual checks

`TESTING_CHECKLIST.md` contains the 15-minute core workflow. The authenticated
`/test-checklist` page performs data sanity checks for owner/admin users.

Choose manual checks that match the change:

- Confirm behavior in all three locales after copy/layout changes.
- Confirm owner, admin, and viewer behavior after permission changes.
- Confirm two different clubs cannot see or mutate each other's data.
- Test before and after the configured business-day boundary for date changes.
- Compare dashboard, detail page, daily/monthly report, and Telegram totals after
  formula changes.
- For inventory, test both tracked and made-to-order products and a historical
  date with a saved closing.

## Database and Telegram precautions

Unit tests inspect important migration guarantees but do not replace testing an
actual migrated Supabase environment for SQL behavior. Never point seed/reset
scripts at production without explicit review.

Use Telegram `dryRun` or the local preview generator before a live send. A live
forced resend is an external side effect and requires an intentional unique
request ID; follow `docs/runbooks/telegram-report.md`.
