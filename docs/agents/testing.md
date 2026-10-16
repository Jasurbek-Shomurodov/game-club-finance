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

`npm install` sets `core.hooksPath` to `.githooks`, whose `pre-commit` hook runs
typecheck, lint, and tests (about 40 seconds). It skips `npm run build`, so run
the build yourself before pushing risky changes. `git commit --no-verify` bypasses
the hook only in an emergency.

## CI and the coverage floor

`.github/workflows/checks.yml` runs on every push and pull request: `npm ci`,
`npm audit --omit=dev --audit-level=high`, typecheck, lint, `npm run
test:coverage`, and the production build with placeholder Supabase values.
`test:coverage` runs the whole suite under v8 coverage (the PGlite tests need no
system package) and then `scripts/check-coverage-floor.mjs` compares
`coverage/lcov.info` with `scripts/coverage-floor.json`: the job fails when line,
branch or function coverage drops below the recorded floor, or when a `src` file
that no test runs is missing from the `untested` list. The floor only rises:
when the script reports that coverage is above the floor or that a listed file
is now tested, raise the numbers or shorten the list in the same change as the
new tests. A high or critical audit finding in a shipped dependency also fails
the job; fix it by updating the dependency, not by relaxing the audit.

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
