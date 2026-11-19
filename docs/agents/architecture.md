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

## Public pages

The site root (`/`) is the public landing page for every visitor: the brand
page named by `PUBLIC_SITE_BRAND_SLUG` (default `pixel-gaming`), or a redirect
to `/login` while that brand is unpublished. Its header Login button opens
`/login`; sign-in and every "back to the app" link go to `DASHBOARD_PATH`
(`/dashboard`, `src/lib/routes.ts`). `/club/<slug>` and `/brand/<slug>` are
public too. The proxy lets these through without Auth; they read only the
anonymous showcase RPCs.

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

Screens that belong together share one sidebar item and are joined by tabs
beside the page title (`src/lib/navigation.ts`, `SectionTabs`): **Bar**
(closing stock, stock purchase, products, promotions), **Owner Profit** (owner
profit, reserve) and **Team** (team, edit history). Every tab is still its own
route with its own page title and feature gate; the sidebar item opens the
first tab the member can open and is hidden when there is none, and a member
with a single tab sees no tabs. Add a screen to a section in
`SECTION_TABS`, pass `useSectionTabs(section)` to its `PageHeader`, and cover
it in `e2e` (NAV-001). A page with views of its own (the reserve's
overview/history) switches them in the page body, not in the header.

On phones (below `lg`) the shell also shows a bottom bar
(`components/layout/BottomNav.tsx`): the first four screens of
`primaryNavItems` the member can open, plus **More**, which opens the menu
drawer. The bar is not rendered while a field has focus (the keyboard is up)
or while the drawer is open. The shell publishes its height as the CSS
variable `--bottom-nav` (0 when the bar is absent or on wider screens); a
page's own sticky bottom bar must sit at `bottom-[var(--bottom-nav,0px)]`, as
the Closing Stock Save bar does, never at `bottom-0` (NAV-002).

Two surfaces reach any screen or frequent task without the menu, both fed by
`src/lib/commands.ts` (`quickActions`, `commandPages`, access-filtered):
the command palette (`components/layout/CommandPalette.tsx`; ⌘K / Ctrl+K or
the top bar's search button) and, on phones, the quick-add sheet behind the
bottom bar's "+". An action that should open a form on arrival (add expense,
add debt) calls `requestQuickAction` before navigating and the page picks it
up with `useQuickAction` (`src/lib/quickActions.ts`): in memory, consumed
once, expiring after ten seconds, never in the URL. To add an action, add it
to `quickActions`, give it an icon and `commands.*` copy, and, if it opens a
form, call `useQuickAction` in the page (CMD-001, NAV-003).
From two typed letters the palette also lists products and people with an
open debt by name (`fetchCommandSearchData`, read once per opening and only
for lists the member can open). Picking one opens the list narrowed to it
through `requestPageSearch` / `usePageSearch`, the same in-memory handoff.

Lists that an accountant may want elsewhere have an **Export** button
(Reports closeout, Monthly Report, Debts, Products). `src/lib/csv.ts` writes the file in the
browser from the rows already on screen, as filtered: no request, no server
route. Amounts are bare numbers; the separator follows the app language
(";" for Russian and Uzbek, where Excel expects it); text typed by people is
escaped so it can never run as a spreadsheet formula. Use `toCsv` and
`downloadCsv` for any further export rather than a new dependency (EXP-001).

The admin app installs on a phone's home screen: `public/admin.webmanifest`,
the icons in `public/icons` (drawn by `scripts/generate-app-icons.mjs`) and
the tags in `src/lib/appInstall.ts`, exported as metadata by the signed-in and
sign-in layouts only, so the public club pages stay a website. The manifest
and icons are excluded from `src/proxy.ts`: browsers fetch them without
cookies. There is no service worker and nothing is cached for offline use, so
an installed app always shows live figures.
While the browser reports no connection the shell shows a notice above the
page (`useOnline` in `DashboardShell`): saving will fail and the figures may
be stale, and the page says so instead of failing silently (NET-001).

Reports works the same way with its own tab row (`reports/ReportsTabs.tsx`):
the closeout, collected and write-off views switch inside `/reports`, and the
Day and Month tabs open `/daily-report` and `/monthly-report`, which show the
same row.

Sidebar routes use intent-based full prefetching. Do not eagerly prefetch every
dynamic route on mount: that would execute protected server work for pages the
user may never visit. During an uncached navigation the current page remains
visible with a slim progress indicator instead of a full-page loading skeleton.
The dashboard (`/dashboard`) does not prefetch because its server response embeds live
financial totals that can change while the user edits another screen.
The month picker in the dashboard header loads an earlier month
(`getDashboardSnapshotRanges(businessToday, month)`): the whole month compared
with the whole month before it, its inventory valued at the month's last
closing count.
Below the headline cards the dashboard shows one glance card per business
(margin, a calendar of the month, weekday averages, where the money went) and
the money-flow diagrams; every figure links to the records behind it.
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
entry (`/api/daily-cash`), changing an expense's payment method or date, and
ticking or unticking a Reports date as collected (`/api/collections`), also
post a notice (`src/lib/telegram/entryChangeNotification.ts`), because
editing or deleting the original message makes no sound in Telegram.
