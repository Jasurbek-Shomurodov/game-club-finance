# 🎮 Game Club Finance

Finance & Accounting web app for a game club.  
**Stack:** Next.js 16 · Supabase · TypeScript · Tailwind CSS · Recharts

---

## Quick Start

### 1. Clone & install

Node.js 20.9 or newer is required.

```bash
git clone <your-repo>
cd game-club-finance
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com). In Database →
   Extensions, enable `pg_cron` and `pg_net`.
2. Install the Postgres 17 client (`brew install postgresql@17`, or
   `postgresql-client-17` on Linux) so `psql` is available.
3. Copy the project's **Session pooler** connection string (Project Settings →
   Database → Connection string) and apply **all** committed migrations in order:

```bash
scripts/db-migrate.sh "postgresql://your-session-pooler-url" --dry-run
scripts/db-migrate.sh "postgresql://your-session-pooler-url"
```

The migrations live in `migrations/`, not `supabase/migrations/`, so
`supabase db push` does not see them. `db-migrate.sh` runs each pending file and
records it in `supabase_migrations.schema_migrations` in the same transaction,
the history the Settings migration health check reads; a failed migration rolls
back and is not recorded. Rerunning applies only new migrations.

It stops without changing anything if the database has tables but no recorded
history, or if an earlier migration is unrecorded while later ones are recorded.
That means migrations were run by hand in the SQL editor. Confirm each listed
version really is applied, record it with
`scripts/db-migrate.sh "<url>" --mark-applied <version>`, then rerun.

Do not run only `001_initial_schema.sql`: later migrations contain required
multi-club, inventory, authorization, and reporting changes.

### 3. Configure env

```bash
cp .env.example .env.local
# Fill in the required Supabase values. Configure the optional Telegram block
# only when the scheduled daily report is enabled.
```

### 4. Create the first owner user

In Supabase Dashboard → Authentication → Users → Add User.  
Then promote their profile to the global owner role. Sign in as that user and
create the first club from Settings; the database will create its owner
membership atomically.

```sql
UPDATE profiles SET role = 'owner' WHERE id = '<user-uuid>';
```

### 5. Run

```bash
npm run dev
# open http://localhost:3000
```

---

## Features

| Page | Description |
|---|---|
| **Dashboard** | Daily, monthly, and custom-range KPIs |
| **Daily Cash** | Game-club income by cash, terminal, card, and PlayStation |
| **Expenses** | Categorized expenses with their payment method |
| **Reports** | Income, expenses, and money left by payment method |
| **Daily Report** | Income, bar activity, debts, expenses, and daily result |
| **Monthly Report** | Daily income, expense, and profit summary for a selected month |
| **Debts** | Customer debts and partial payment history |
| **Products & Stock** | Product prices, purchases, daily closings, inventory value, and low-stock alerts |

## Roles

| Role | Can do |
|---|---|
| **owner** | Everything |
| **admin** | Record daily cash and expenses, manage assigned ledgers, and view enabled reports |
| **viewer** | Read dashboards, reports, and ledgers without changing financial data |

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Project documentation

- [Agent guide](AGENTS.md) — concise rules and task-specific reading map
- [Architecture](docs/agents/architecture.md)
- [Finance definitions](docs/agents/domain-finance.md)
- [Inventory and closing stock](docs/agents/inventory.md)
- [Database and authorization](docs/agents/database.md)
- [Testing guide](docs/agents/testing.md)
- [Telegram report runbook](docs/runbooks/telegram-report.md)
- [Database backup runbook](docs/runbooks/database-backup.md)

## Scheduled Telegram report

The daily finance report is generated independently per club and delivered as a
PNG, with a safe text fallback when rendering fails before dispatch:

```text
Supabase data → calculations → SVG → PNG → Telegram sendPhoto → delivery status saved
```

Supabase Cron runs it at `03:00 UTC` (`08:00 Asia/Tashkent`) for the previous
Tashkent business date. Delivery is idempotent, and uncertain post-dispatch
outcomes are held for manual review rather than automatically resent. See the
[Telegram report runbook](docs/runbooks/telegram-report.md) for configuration,
deployment order, previewing, recovery, and intentional resend procedures.

## Localization

Switch language from the sidebar footer: **RU / UZ / EN**
