# Database and authorization guide

Read this before changing Supabase queries, RPCs, RLS, membership behavior, or
migrations.

## Current application tables

| Table | Purpose | Important behavior |
|---|---|---|
| `profiles` | Global user identity/profile | Global role is not a substitute for club membership. |
| `clubs` | Club configuration | Holds business-day start and enabled payment methods. |
| `club_memberships` | Per-club role/access | Holds role and optional `feature_access`. |
| `products` | Catalog/live balance | Soft deletion preserves ledger history. |
| `stock_purchases` | Inventory purchase ledger | Write through inventory RPCs. |
| `daily_stock_counts` | Daily bar/accounting snapshots | Save through closing RPC. |
| `daily_cash_entries` | Game-club collections | Owners/admins write under time/role rules. |
| `expenses` | Current expense ledger | Includes `payment_source` and payment method. |
| `new_debts` | Debt principal ledger | Append-only to application users. |
| `debt_payments` | Debt collection ledger | Append-only; trigger updates parent. |
| `owner_withdrawals` | Monthly/source withdrawals; Game Club rows may name a `payment_method` (066) | Insert through `withdraw_owner_money_for_month` or `withdraw_owner_game_club_money_by_method`. |
| `owner_profit_carryovers` | Unwithdrawn profit moved from `from_month` to the next month (071) | Select only; write through `carry_owner_profit_to_next_month` and `delete_owner_profit_carryover`. |
| `promotions` | Owner-managed bonus rules (078) | Owner writes; members with inventory/stock/report access read. |
| `telegram_report_deliveries` | Service-only delivery state | Never expose to browser roles. |

Retired read-only ledgers: `income_transactions`, `expense_transactions`, and
`cash_movements`.

## Authorization model

Authorization has three layers:

1. Authenticated Supabase user.
2. Membership and role for the specific `club_id`.
3. Optional per-membership feature access.

`src/lib/permissions.ts` controls navigation and client access behavior.
Migration 033 applies corresponding RLS policies to reads and writes. UI checks
improve UX; RLS and database constraints remain authoritative.

Migration 054 keeps the same read feature unions but obtains permitted club IDs
through `current_user_readable_clubs(text[])` once per statement. It delegates
to the existing membership feature helper and never accepts a caller-supplied
user ID. Keep the policy subquery uncorrelated: passing each ledger row's club
into a permission function repeats membership work across history scans.
Stock insert/update/delete policies retain 033's predicates, but are separate
operations so the old `FOR ALL` write checks no longer run during SELECT.
`ledgerReadPermissions.test.ts` executes the original and new policies in local
PostgreSQL and compares read/write results, cross-club denial, and the query plan.

Owner-only behavior includes team management and destructive/sensitive finance
operations. At least one owner must remain in a club.

Migration 074 makes team access club-scoped, because unrelated owners share one
database. Owning one club grants nothing in another: membership inserts,
updates and deletes require `current_user_club_role(club_id) = 'owner'`, and an
insert may only add an open access request (no memberships, not rejected) or
someone who already shares a club with the caller. Profiles are readable as
self, by club-mates, or (for owners) as open requests; updates are limited to
people in a club the caller owns. A membership's `club_id`/`user_id` cannot be
changed. `current_user_is_global_owner()` remains only for
`create_club_with_owner`. `reject_access_request` locks the profile, re-checks
that it is still an open request and marks it rejected; `/api/team/reject`
deletes the auth user only after it returns `rejected`. Open requests are still
visible to every club owner until requests are targeted at a club.
`clubScopedTeamAccess.test.ts` runs 014/031/072/074 in local PostgreSQL.

## Client selection

- Browser: `src/lib/supabase/client.ts`; respects the user's RLS.
- Authenticated server: `src/lib/supabase/server.ts`; validate using
  `auth.getUser()`.
- Service role: `src/lib/supabase/service.ts`; trusted server-only tasks. Because
  it bypasses RLS, explicitly scope every query and validate external inputs.

## Application RPCs

| RPC | Purpose |
|---|---|
| `create_club_with_owner` | Atomically create a club and its owner membership. |
| `record_stock_purchase` | Insert purchase and update stock/cost safely. |
| `delete_stock_purchase` | Remove a purchase and repair inventory safely. |
| `save_closing_stock_counts` | Save/validate daily counts and historical chain. |
| `withdraw_owner_money_for_month` | Atomically withdraw a custom amount for one month/source, or allocate across both sources. |
| `take_all_owner_money_for_month` | Atomically take one month/source remainder. |
| `get_dashboard_snapshot` | Efficient dashboard payload. |
| `get_dashboard_bootstrap` | Authenticated profile, memberships, and club configuration in one payload. |
| `get_finance_report_snapshot` | Selective, date-bounded finance ledgers for report/detail screens. |
| `get_stock_opening_balances` | Latest closing plus receipts on intervening unclosed dates. |
| `get_latest_stock_closings` | Raw latest product closings for older clients. |
| Delivery ledger RPCs | Claim, begin dispatch, and complete Telegram delivery. |
| `reject_access_request` | Atomically reject an open access request (074). |
| `get_owner_profit_snapshot_with_methods` | 050 owner-profit payload plus each withdrawal's `payment_method` (076). |
| `record_salary_entry_with_status` | `record_salary_entry` that also reports whether it inserted (077). |

PostgreSQL functions execute as `PUBLIC` unless restricted. Security-definer
functions must set a safe `search_path`, validate actor/club access, and have
explicit grants/revokes. Follow the patterns in the latest migrations.

## Pagination and query rules

Supabase commonly caps responses at 1,000 rows. Use `fetchAllRows` for complete
period/history totals. Build each page of a paginated query with the same
filters and deterministic ordering.

Always include `club_id` in browser and service-role queries for club-owned
tables, even when RLS would also filter it.

## Migration workflow

1. Inspect the latest migrations affecting the same objects; later migrations
   may deliberately replace early definitions.
2. Add a new SQL file with the next unique numeric prefix.
3. Make the final state safe for databases with all prior migrations applied.
4. Preserve data and ledger history; use an explicit audited repair when needed.
5. Restrict function execution and test important SQL text/behavior patterns.
6. Apply all committed migrations in order with `scripts/db-migrate.sh <db-url>`
   (`--dry-run` first). `supabase db push` does not read the top-level
   `migrations/` folder. See the README for unrecorded-history handling.
7. Coordinate database-first deployment when new application code requires a
   new function, column, constraint, or delivery ledger state.

Do not edit an old migration to fix a deployed database. Do not run only
`001_initial_schema.sql` when building a new environment.

## Compatibility fallbacks

Some membership selects retry without newer columns, and performance RPC reads
temporarily fall back to table queries. These handle application/database
deployment skew. Removal requires a deliberate cleanup after deployment state
is known, along with updates to fallback tests.

## Settings migration health

Owners can run the read-only Settings health check after applying
`052_migration_health.sql`. The RPC authorizes the selected club's owner before
reading metadata. It returns recorded migration versions and direct function
checks for 050/051; it never invokes a withdrawal RPC or returns function bodies.
`scripts/db-migrate.sh` records versions there; SQL Editor execution does not,
so an unrecorded version is **unconfirmed**, not proof of a missing migration.
Exact function-body fingerprints identify a match to this app version; different
bodies require review, including harmless manual formatting changes.

When adding a migration, update `src/lib/supabase/migrationManifest.json` with its
filename. The manifest test checks that no committed migration is omitted. When
replacing a checked function in a future migration, add a new migration updating
the diagnostic fingerprints and their tests together.

For an existing withdrawal RPC that blocks manual execution of 051, use
`scripts/repair-051-custom-owner-withdrawals.sql` to apply its two definitions in
one transaction, then apply 052. The repair script preserves ledger rows and
does not update CLI migration history. Do not mark a version applied solely
because one function exists.

## Payroll (migration 059)

Migration 061 lets all club members view salaries. Owners retain editing access; other members require the explicit `salaries` feature grant from Team. RLS enforces member reads and every payroll mutation RPC checks editing access. Use
`save_salary_employee` for employee/rate changes and `record_salary_entry` for
payments, bonuses and fines. Pass a stable request UUID on entry retries.
The payment RPC atomically inserts the payroll entry and linked `expenses` row;
composite foreign keys prevent cross-club links. Linked salary expenses cannot
be changed/deleted, even through the ordinary expense endpoint. Report delivery
metadata can still be updated. Direct browser writes to payroll tables are denied.
Apply all pending migrations in order before using `/salaries`; the page reports
a load error rather than calculating misleading zero balances without its schema.

Future salary employees are supported by migration `060_future_salary_employees.sql`. They accrue nothing before joining. `change_salary_term` changes only salary or KPI under the employee lock, effective on the club business date (or the future joining date), preserving the other terms and earlier rates.

Migration 062 adds audited deletion for salary entries and rates. `delete_salary_record` requires salary editing access and retains the original row with `deleted_at`/`deleted_by`. Payment deletion removes the linked expense atomically; direct payroll mutations remain forbidden. Calculations exclude deleted rows; history displays them. Deleting a rate extends the preceding rate until the next live rate and may change historical KPI/balances. Operations live at `/salaries`, employees at `/salaries/employees`, and individual history at `/salaries/employees/[employeeId]`.

Migration 063 adds `deactivate_salary_employee`: salary editors can stop accrual from the current club business date, or the joining date for upcoming staff. It preserves the latest salary/KPI terms under a lock and does not remove payment history. Employee cards offer History and Deactivate only; forms stay on `/salaries`.

Migration 064 adds `change_salary_employee_role` for salary editors. It changes only the employee job title (Manager, Admin, Cleaner), without touching salary rates, entries, or Team membership permissions.

Migration 065 adds `get_salary_profit_snapshot`: it checks club membership,
then returns only monthly earned-cash inputs under a trusted role. This keeps
payroll KPI independent of finance feature grants without widening ledger RLS.
The application fails closed if this RPC is missing; apply 065 before deploying
its salary loader. It reuses the canonical owner-profit aggregate without changing
that function or its migration-health fingerprint. The same migration prevents
deleting the final live salary rate under the employee lock. Employee settings
can restore a missing rate left by older versions, retaining deleted audit rows.

Migration 067 makes payroll terms owner-only: `save_salary_employee`, `change_salary_term`, `deactivate_salary_employee`, the new `activate_salary_employee`, `change_salary_employee_role` and rate deletion in `delete_salary_record` require the club `owner` role. Members with the `salaries` feature grant (Team page) can still call `record_salary_entry` (payments, bonuses, fines) and delete entries. The browser calls `POST /api/salaries`, which runs these RPCs as the signed-in user and then posts a Russian Telegram notification to the club's group (`src/lib/telegram/salaryNotification.ts`). Notification failures never roll back the payroll change; retried entry request ids do not notify twice. Operations live at `/salaries/operations`, employees (the default tab) at `/salaries` and `/salaries/employees`.

Migration 066 adds a nullable `owner_withdrawals.payment_method` (`cash`,
`terminal`, `card`, `playstation`; Game Club rows only) and the owner-only RPC
`withdraw_owner_game_club_money_by_method`. A second insert trigger caps a
method withdrawal by that method's monthly Game Club balance; the existing 051
trigger still caps the overall Game Club month. Older rows stay unassigned and
are never reclassified. The 050/051 function bodies tracked by migration health
are unchanged. Owner Profit reads the column separately and falls back to
source-only withdrawals when it is missing.

Migration 071 adds `owner_profit_carryovers` and redefines the internal helpers
`owner_source_earned_for_month` and `owner_payment_method_earned_for_month` to
add money carried in and subtract money carried out, so the unchanged 051/066
withdrawal triggers and RPCs respect carryovers. The 050/051 bodies tracked by
migration health are untouched; `get_owner_profit_snapshot` does not include
carryovers, so Owner Profit reads the table separately and treats a missing
table as no carryovers.

Migration 068 fixes expense categories to `rent, salary, electricity, internet, repair, cleaning, food_drinks, marketing, equipment, tax, correction, discount, other` (`src/lib/expenseCategories.ts`, with a `expenses_category_known` check and validation in `POST /api/expenses`). Earlier free-text categories were remapped; the original text was moved into the start of the expense comment. Do not reintroduce user-defined categories; add a new key to the list, all three message files and the Telegram labels instead.

Migration 069 removes the vague `other` expense category: existing `other` rows became `supplies` and the check constraint no longer allows `other`. The form requires an explicit category choice, and `salary` is no longer selectable: salary expenses come only from `record_salary_entry` (the constraint still allows them; `POST /api/expenses` rejects them). `other` remains only as a label for legacy rows and the dashboard chart's "small slices" bucket.

Migration 070 adds `kpi_basis` (`overall_profit` default, `owner_profit`), `kpi_game_club` and `kpi_bar` to `salary_rates`, replaces `save_salary_employee` and `change_salary_term` with versions that accept them (null keeps the rate in force today), and makes `get_salary_profit_snapshot` return monthly withdrawn totals per pool.

Migration 075 defaults `new_debts.created_by` to `auth.uid()` and requires it to
equal `auth.uid()` on insert, so the debt author cannot be forged.

Migration 076 adds `get_owner_profit_snapshot_with_methods` instead of
replacing 050, whose body is fingerprinted by migration health and also used by
payroll. The app falls back to 050 plus a method query when it is missing.

Migration 077 adds `record_salary_entry_with_status` (062 body, new return
shape) so `POST /api/salaries` notifies only for a newly inserted entry; older
databases fall back to a lookup plus `record_salary_entry`. Entry and rate
deletes also go through `POST /api/salaries` (`delete_record`) and notify.
`POST /api/expenses` accepts a client `id` for idempotent retries and rejects
payment methods the club has not enabled.

Migration 078 adds `promotions` plus `daily_stock_counts.giveaway_quantity`,
`giveaway_cost` and `promotion_id`, and replaces `save_closing_stock_counts`
and `validate_daily_stock_count_integrity` with giveaway-aware versions
(`promotionsMigration.test.ts` runs it in local PostgreSQL). The closing page
reads the new columns with a fallback for older databases, but saves need the
new RPC, so apply 078 before deploying.
