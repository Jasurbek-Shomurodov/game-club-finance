# Architecture guide

Read this for runtime boundaries and data flow. Domain and database rules live
in their focused guides.

## Runtime shape

The application uses Next.js App Router, React, TypeScript, Supabase, Tailwind,
next-intl, and Recharts.

```text
request
  -> src/proxy.ts (cookie-aware auth routing)
  -> dashboard server layout/bootstrap
  -> client page and selected-club context
  -> Supabase query/RPC
  -> pure src/lib/calculations functions
  -> translated UI
```

`src/proxy.ts` avoids a duplicate remote `getUser()` when an auth cookie exists;
the protected dashboard layout performs the authoritative validation. Do not
move authorization entirely into cookie presence.

## Supabase clients

| Module | Use |
|---|---|
| `src/lib/supabase/client.ts` | Browser components. Singleton client with a safe read cache. |
| `src/lib/supabase/server.ts` | Server components and authenticated server reads. Uses cookies and `auth.getUser()`. |
| `src/lib/supabase/service.ts` | Trusted server-only jobs such as Telegram delivery. Bypasses RLS. |

Never import the service client into a client component. Its key is privileged.

## Authentication and club context

`getDashboardBootstrap()` authenticates the user and loads profile,
memberships, clubs, per-club feature access, business-day start, and enabled
payment methods through `get_dashboard_bootstrap`. React `cache()` shares that
work inside one server request. A direct-query compatibility fallback remains
for deployments where migration 048 has not reached the database yet.
Remote user validation and the independently authorized bootstrap RPC run in
parallel; account data is returned only after `auth.getUser()` validates the user.
The protected layout streams a data-free placeholder during bootstrap, then
the authenticated shell. A separate dashboard snapshot Suspense boundary keeps
financial reads from blocking that shell. Do not render protected content in
the outer fallback or cache authentication across requests. Anonymous protected
requests redirect in the proxy without a remote auth call.

`DashboardShell` owns the selected-club client context and refreshes membership
data. The selected club is remembered in the
`game-club-finance-selected-club-id` cookie. Treat that selection as UI state,
not authorization: queries still require `club_id`, and RLS must authorize it.

Navigation visibility and redirects use `src/lib/permissions.ts`. Database RLS
in migration 033 mirrors those feature gates. A new feature or route may require
changes in both places.

Sidebar routes use intent-based full prefetching. Do not eagerly prefetch every
dynamic route on mount: that would execute protected server work for pages the
user may never visit. During an uncached navigation the current page remains
visible with a slim progress indicator instead of a full-page loading skeleton.
The dashboard root does not prefetch because its server response embeds live
financial totals that can change while the user edits another screen.
The dashboard keeps only headline totals and the income trend; its chart
starts only when the intersection observer enables it. Detailed breakdowns
(sankey money flow, categories, daily and 12-month trends, payment methods,
largest payments) live on `/financial-analysis`, which uses the `dashboard`
feature gate and `src/lib/calculations/financialAnalysis.ts`.

## Page and calculation boundaries

- Pages fetch rows and coordinate interactions.
- Pure calculations belong under `src/lib/calculations` and have colocated
  Vitest coverage.
- Cross-page data shapes live in `src/types/index.ts`.
- Data sets that may exceed 1,000 rows use `fetchAllRows` from
  `src/lib/supabase/pagination.ts`.
- The dashboard prefers `get_dashboard_snapshot`; closing stock prefers
  `get_stock_opening_balances` (latest closing plus intervening receipts). Both retain temporary direct-query fallbacks for
  deployments where the application arrives before the database migration.
- Daily/monthly reports and dashboard money-detail routes prefer the selective
  `get_finance_report_snapshot`. Pass only the ledger sections the screen needs;
  direct table queries remain only as the migration-049 compatibility path.

Do not copy a financial formula into a page to avoid importing a calculation.
That creates divergent dashboard, report, and Telegram totals.

## Localization

`next-intl` uses `src/messages/en.json`, `ru.json`, and `uz.json`. The application
time zone is `Asia/Tashkent`. Add the same key and compatible interpolation
arguments to all three locale files in one change.

## Telegram pipeline

The scheduled server route is separate from browser auth and uses the service
client:

```text
Supabase rows -> financial calculations -> localized report -> SVG/PNG
  -> Telegram sendPhoto (or pre-dispatch text fallback) -> delivery ledger
```

Read `docs/runbooks/telegram-report.md` before changing this pipeline.

Separately, finance API routes post short club-group messages as the signed-in
user, best-effort and after the response (`after()`), only to the group
`targetChatId` configures for the club: new expenses, exchanges and payroll
changes announce themselves; deleting an expense, exchange or daily income
entry (`/api/daily-cash`), and changing an expense's payment method or date,
also post a notice (`src/lib/telegram/entryChangeNotification.ts`), because
editing or deleting the original message makes no sound in Telegram.
