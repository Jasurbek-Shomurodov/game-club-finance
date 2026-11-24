# Activity notices: tell the club's Telegram group about every action investors should know

## Goal and user flow

Investors do not use the app; they read the club's Telegram group. Every action
that changes money, stock, prices, people or access must reach that group as it
happens, and stay in the database as a permanent record.

Decisions made by the user (24 Nov 2026):

- Delivery is **Telegram, to each club's own group** (`targetChatId`).
- Money entries: History keeps showing **edits and deletions only**.
- Scope: chosen by us, below.

### Inventory: what is announced today and what this plan adds

| Area | Action | Today | This plan |
|---|---|---|---|
| Expenses, income edits, exchanges, reserve moves, day collected, money collected, salary terms and entries, bar write-offs | all | Telegram notice exists | untouched |
| Products | created, renamed, category, sale price, cost price, switched off/on, archived | nothing | **notice** |
| Closing stock | an already saved count changed, a stock correction set/changed/removed | nothing instant | **notice** (write-offs keep their own notice, no duplicate) |
| Promotions | created, edited, switched on/off, deleted | nothing | **notice** |
| Team | access granted, role changed, page access changed, access removed | nothing | **notice** |
| Club settings | name, address, business-day hour, payment methods, internet payment day | nothing | **notice** |
| Planned expenses (`expense_presets`) | created, changed, archived | nothing | **notice** |
| Salaries | employee name or job title changed; payment method of a payment corrected | nothing | **notice** |
| Owner money | withdrawal recorded or deleted; profit carried to next month or carryover deleted | History only (delete) | **notice** |
| Stock purchases | recorded, deleted | History only (delete) | **notice** |
| Debts | new debt, debt payment | nothing | **notice** |
| Collected money | deleted, moved to reserve | History only, unlabelled | **notice** + History label |
| Cash shortages | recovered, deleted | History only | **notice to the owners' chat** (`ownerChatId`, where the shortage itself is announced; never the club group) |
| New daily income | | daily report | not announced (dozens per day; the report totals it) |
| Public page, Google profile, sign-ins, product reorder, derived stock recalculation, rejected sign-up | | | not announced |

## Placement

No new screen. The permanent record is the existing `/history` ledger (Manage
area). Telegram texts are Russian, like every other club notice.

## Architecture

Capture is in the database so nothing depends on which page or route wrote the
row; delivery reads the captured rows, so a message always reports what the
database holds, never what a browser claims.

1. **Capture**: triggers write `entry_audit_logs` rows (migration 182).
2. **Mark**: a before-insert trigger on `entry_audit_logs` sets
   `notice_pending = true` for tables whose changes have no notice of their own.
3. **Deliver**: `deliverActivityNotices(clubId)` (`src/lib/telegram/activityDelivery.ts`,
   service client) claims pending rows through the service-only RPC
   `claim_activity_notices`, resolves names (profiles via `fetchProfileNames`,
   products, salary employees), builds messages with pure builders in
   `src/lib/telegram/activityNotification.ts`, sends them oldest first with
   `sendTelegramMessage`. Rows for the same table + row in one batch are merged
   into one before → after message (page-access toggles, several fields).
   A builder returns `null` for a row that must not be announced (see below).
4. **Trigger delivery**:
   - `POST /api/activity` `{ clubId }`: `auth.getUser()`, the caller must be a
     member of that club, then `after(() => deliverActivityNotices(clubId))`.
     Best effort; never fails or delays the save.
   - Browser helper `announceActivity(clubId)` (`src/lib/activityNotices.ts`,
     fire and forget) called after each successful write on: Products,
     Promotions, Team (`useTeamMembers`), Settings (club details, hour, methods,
     internet day, expense presets), Closing Stock and Write-offs saves, Stock
     Purchase (record, delete), Money Taken (withdraw, delete, carry, delete
     carryover), Debts (new, payment), collected money delete / move to reserve,
     cash shortage recover / delete.
   - Server routes that already run after a write call
     `deliverActivityNotices` directly in their `after()`: `/api/salaries`,
     `PATCH /api/expenses` (salary payment method).
   - Safety net: the daily finance report cron calls
     `deliverActivityNotices` for every configured club before building the
     report, so a notice whose browser call was lost still goes out that night.

Builder rules:

- `daily_stock_counts` update: announce when `closing_stock` changed, or when
  the adjustment is/was a correction; return `null` when only a write-off
  (shortage/expired) changed, because `/api/stock-write-offs` announces it.
- `cash_shortages`: chat is `ownerChatId`; no owners' chat → not sent.
- `products` update where only `is_deleted` became true → "archived".
- Money amounts through `sum()` from `messageParts`; unit prices keep
  fractions; dates through `noticeDate`; author through `authorLine`
  (`changed_by` null → «Система»).
- Each message says what changed as `Поле: было → стало`, like
  `buildExpenseChangedNotice`.

History (`/history`) in slice 1: `fetchEntryHistory` filters to
`AUDITED_TABLES` and `action in ('update','delete')`, so the new rows do not
show as raw keys before slice 3 labels them.

## Data model: migration `182_activity_audit.sql` (additive)

- `entry_audit_logs`:
  - `action` check allows `'insert'`; `old_row` becomes nullable; the
    consistency check becomes: insert ⇒ old null and new not null; update ⇒
    both; delete ⇒ old only. Existing rows satisfy it.
  - new `notice_pending boolean not null default false`; partial index
    `(club_id, id) where notice_pending`.
- `record_activity_audit()` trigger function, security definer, execute revoked
  from everyone like `record_entry_audit` (which is **not** changed). Arguments:
  club column, row-id column, then the watched columns. Insert → `new_row`;
  delete → `old_row`; update → logged only if a watched column differs. Same
  guard for a club that is being deleted, `changed_by = auth.uid()`,
  `changed_on = club_business_date(club, now())`.

| Table | Events | Club col | Row id | Watched columns |
|---|---|---|---|---|
| `products` | insert, update | club_id | id | name, category, sale_price, cost_price, low_stock_threshold, is_active, is_deleted |
| `daily_stock_counts` | update | club_id | id | closing_stock, adjustment_quantity, adjustment_reason |
| `promotions` | insert, update, delete | club_id | id | name, product_id, free_quantity, min_spend, starts_on, ends_on, is_active |
| `club_memberships` | insert, update, delete | club_id | user_id | role, feature_access |
| `clubs` | update | id | id | name, address, business_day_start_hour, enabled_payment_methods, internet_payment_day |
| `expense_presets` | insert, update | club_id | id | name, category, payment_source, payment_method, monthly_amount, archived_at |
| `salary_employees` | update | club_id | id | name, job_title |
| `salary_entries` | update | club_id | id | payment_method, payment_source |
| `owner_withdrawals`, `owner_profit_carryovers`, `stock_purchases`, `new_debts`, `debt_payments` | insert only | club_id | id | (all) |

  `products.cost_price`/`sale_price` moved by the purchase trigger
  (`pg_trigger_depth() > 1`) is not logged: the purchase is the record. The
  insert-only triggers do not duplicate `record_entry_audit`, which keeps
  logging those tables' updates and deletes.
- `mark_audit_notice_pending()` before-insert trigger on `entry_audit_logs`:
  `notice_pending := true` when `table_name` is one of the tables above, or
  `money_collections` / `cash_shortages`, or an update/delete of
  `owner_withdrawals`, `owner_profit_carryovers`, `stock_purchases`.
- `claim_activity_notices(p_club_id uuid, p_limit int default 50)`: security
  definer, execute granted to `service_role` only; flips `notice_pending` to
  false on the oldest pending rows of that club (`for update skip locked`) not
  older than 3 days, and returns them ordered by id.
- RLS on `entry_audit_logs` unchanged (owners read; nobody writes).
- Regenerate the manifest; update the `entry_audit_logs` row in
  `docs/agents/database.md` and add the flow to
  `docs/runbooks/telegram-report.md`.

## Design rules

Slice 3 only: existing History layout; `insert` badge tone `success`; group
filter (money, bar, people, club); new `history.tables.*`, `history.fields.*`,
`history.actions.insert` in the three locales; rows link to the owning page
through `auditRecordHref`; `EntryHistorySkeleton` follows any layout change.

## Tests

- `activityNotification.test.ts`: one case per table and action, the `null`
  rules, merging, the owners'-chat routing.
- `activityDelivery.test.ts`: claim → names → send order; a send failure does
  not throw.
- `activityAuditMigration.test.ts` beside `entryAuditLogMigration.test.ts`:
  trigger list and arguments, checks, grants, `record_entry_audit` untouched.
- `src/lib/supabase/entryHistory.test.ts`: the History filter.
- Route test for `/api/activity` (401, 403 for a non-member, 200).
- e2e changes only in slice 3.

## Slices

1. **Capture and deliver.** Migration 182, builders, delivery, `/api/activity`,
   the cron safety net, the History filter, docs. Announces nothing until
   slice 2 calls it, except through the nightly safety net.
2. **Call sites.** `announceActivity` / `deliverActivityNotices` at every write
   listed above.
3. **History labels.** The new tables, inserts and `money_collections` on
   `/history`, three locales, e2e. Waits until the reserve/reports work now
   uncommitted in the tree has shipped (it edits the same locale files and
   `e2e/p0.spec.mjs`).

Reviewer on slices 1 and 2 (migration, club scoping, Telegram).

## Risks and open questions

- **Another session is editing this tree** (reserve explorer, reports: locale
  files, `e2e/p0.spec.mjs`, reserve and reports pages, charts). Slices 1 and 2
  must not touch `src/messages/*`, `e2e/`, `src/app/(dashboard)/reserve`,
  `src/app/(dashboard)/reports`, `src/components/charts`,
  `src/components/owner-reserve`, `src/lib/calculations`, `src/lib/formatters*`.
- Withdrawals and access changes go to the club group, which admins read.
  Admins already see Owner Profit by default; say so in the report to the user.
- Notices start from the day 182 is applied; nothing earlier is announced.
- A claimed notice whose Telegram send fails is not retried (same as every
  other club notice); the failure is logged.
