# Game Club Finance agent guide

This file is the short operating guide for coding agents. Read only the linked
guide relevant to the task; do not load every document or migration by default.

## Project map

- `src/app`: Next.js App Router pages and API routes.
- `src/components/PresentationFoundation`: every reusable presentational
  component (buttons, fields, cards, modals, tables, pickers, skeletons). Pages
  compose these instead of writing bespoke Tailwind markup. See its `README.md`.
- `src/components`: layout shell, dashboard charts, money-details, and i18n.
- `src/lib/calculations`: pure financial and inventory calculations. Reuse these
  functions instead of recreating formulas in components.
- `src/lib/supabase`: browser, server, and service clients plus query helpers.
- `src/lib/telegram`: daily report assembly, rendering, transport, and delivery.
- `src/messages/{en,ru,uz}.json`: all user-facing translations.
- `migrations`: the ordered production schema and database behavior.
- `scripts`: explicitly invoked maintenance and preview scripts.

## Read by task

| Task | Read |
|---|---|
| Runtime structure or data flow | `docs/agents/architecture.md` |
| Totals, reports, owner money, or financial definitions | `docs/agents/domain-finance.md` |
| Products, purchases, or closing stock | `docs/agents/inventory.md` |
| Tables, RLS, RPCs, auth, or migrations | `docs/agents/database.md` |
| Verification strategy | `docs/agents/testing.md` |
| Telegram reports, cron, retries, or deployment | `docs/runbooks/telegram-report.md` |
| Database backups or restore | `docs/runbooks/database-backup.md` |
| Public site domain and admin subdomain | `docs/runbooks/public-domain.md` |
| Google Maps (Business Profile) posting | `docs/runbooks/google-business-profile.md` |

## Non-negotiable invariants

1. Scope every club-owned read and write to the selected `club_id`. UI state is
   not an authorization boundary; Supabase RLS and database constraints are.
2. A club's current date is its business date. Use `todayIso`,
   `currentYearMonth`, and related helpers from `src/lib/utils.ts`; do not add an
   ad hoc UTC or calendar-date implementation.
3. Use functions from `src/lib/calculations` as the canonical application
   formulas. Keep accounting profit separate from cash-left calculations.
4. Use the established atomic RPCs for inventory, closing stock, club creation,
   and owner withdrawals. Do not replace them with multiple browser writes.
5. Debts and debt payments are append-only accounting ledgers. A payment insert
   updates its parent through database logic; application users must not rewrite
   or erase that history.
6. Saved historical stock counts are accounting snapshots. Do not silently
   recompute them from later edits to purchase metadata.
7. The retired `income_transactions`, `expense_transactions`, and
   `cash_movements` tables are historical/read-only. New finance writes use the
   current ledgers listed in `docs/agents/database.md`.
8. Preserve migration compatibility fallbacks unless the task explicitly proves
   every deployed database has the required migration and removes the fallback
   as a coordinated change.
9. Add a new uniquely numbered migration for database changes. Never rewrite an
   already-applied migration to alter production state. Apply all migrations in
   order; `001_initial_schema.sql` is not a complete schema by itself.
10. When visible copy changes, update `en.json`, `ru.json`, and `uz.json`
    together and preserve matching message shapes.
11. Never expose `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, Telegram tokens,
    Google OAuth secrets or refresh tokens, or private environment values to
    client code, logs, fixtures, or documentation.

## Implementation conventions

- Prefer `@/` imports for `src` modules.
- Format every user-facing date and monetary amount, including form inputs.
  Use the shared `DatePicker`/`MonthPicker` from
  `src/components/PresentationFoundation` and date formatters from
  `src/lib/formatters.ts` so dates follow the selected app language; keep stored
  dates in ISO format. Do not use raw native date inputs for visible forms.
  Show prices and money with thousands separators (for example, `1 000 000`).
  For whole-UZS inputs, use `formatCurrencyInput` while editing and
  `parseCurrencyInput` when saving; use `formatCurrency` for totals and
  `formatUnitCurrency` where fractional unit prices must be preserved. Do not
  pass formatted money strings directly to `Number()` or silently discard
  required precision.
- Keep business logic pure and tested under `src/lib`; components should mainly
  coordinate queries, state, and rendering.
- Build UI from `@/components/PresentationFoundation`: `Button`/`IconButton`
  for actions, `Field` + `Input`/`CurrencyInput`/`Select`/`Textarea` for forms,
  `Card`/`SectionHeading`/`PageHeader` for structure, `InlineAlert`/`useToast`
  for feedback, `Modal`/`useConfirm` for dialogs (never `window.confirm`),
  `DataTable`/`MetricCard`/`StatTile` for data. Do not reintroduce global
  `.btn-*`/`.input-field`/`.card` CSS classes.
- Use `src/lib/supabase/client.ts` only in browser code,
  `src/lib/supabase/server.ts` in authenticated server code, and
  `src/lib/supabase/service.ts` only in trusted server-only operations.
- Server authentication must validate with `auth.getUser()` rather than trusting
  a cookie session payload.
- Use `fetchAllRows` when a query can exceed Supabase's 1,000-row response cap.
- Keep payment methods within the club-configured subset of `cash`, `terminal`,
  and `card`; normalize through `src/lib/paymentMethods.ts`.
- Preserve unrelated user changes in a dirty working tree.

## Git push destination

When the user requests a commit and push, they authorize pushing the requested
project changes to `git@github.com:Jasurbek-Shomurodov/game-club-finance.git`
(`origin`, cloned locally through the `github-dangerhoggish` SSH host alias),
including `main`. Do not ask again solely to confirm this destination.
Verify the remote still matches before pushing. This authorization does not
include force pushes, unrelated changes, or secrets.

Always push finished work to `main`. If a session assigns a feature branch, you
may also push that branch, but land the same commits on `main` with a
fast-forward or merge commit, never a force push. Run the verification checks
below before pushing to `main`.

## Verification

Run the narrowest relevant test first, then broaden according to risk:

```bash
npx vitest run path/to/relevant.test.ts
npm run typecheck
npm run lint
npm test
npm run build
```

Financial, authorization, migration, configuration, or cross-route changes
normally require the full four quality checks. See `docs/agents/testing.md` for
the change-to-test matrix and manual checks.

The git hooks run CI's checks locally on exactly what is committed or pushed:
`pre-commit` runs typecheck, lint and `test:coverage`; `pre-push` runs the
dependency audit and, when app code changes, `test:e2e:full`. Do not skip them
with `--no-verify` unless the user agrees. Changing a route, redirect, sign-in
flow or a page the browser suite visits means updating `e2e/` in the same
commit.

After every push, run `npm run ci:watch` and wait for the result. A red
"Project checks" run on `main` is fixed before any other work, never left for
later pushes to pile onto.
