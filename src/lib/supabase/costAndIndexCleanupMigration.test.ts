import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'migrations/081_cost_and_index_cleanup.sql'), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
const outsider = '00000000-0000-0000-0000-000000000009';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const visibleClubs = (userId: string, table: string) => asUser(userId, async () =>
  (await db.query<{ club_id: string }>(`select club_id from public.${table} order by club_id`)).rows.map((row) => row.club_id));

const purchaseBaseline = new Map<string, string[]>();

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin;
    create role anon nologin;
    create schema auth; grant usage on schema public, auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.user_role as enum ('owner','admin','viewer');
    create table public.clubs (id uuid primary key);
    create table public.club_memberships (club_id uuid, user_id uuid, role public.user_role, primary key (club_id, user_id));
    grant select on public.club_memberships to authenticated;
    insert into public.club_memberships values
      ('${club}','${owner}','owner'),('${club}','${admin}','admin'),('${club}','${viewer}','viewer'),
      ('${otherClub}','${outsider}','owner');
    create function public.current_user_club_role(p_club_id uuid) returns user_role language sql stable security definer set search_path=public as $$
      select role from public.club_memberships where club_id=p_club_id and user_id=auth.uid()
    $$;
    create function public.current_user_can_access_club_feature(p_club_id uuid, p_feature text) returns boolean
      language sql stable as $$ select true $$;
    create table public.profiles (id uuid primary key, full_name text);
    create table public.daily_cash_entries (id uuid default gen_random_uuid(), club_id uuid, date date, cash_income numeric, terminal_income numeric, card_income numeric, playstation_income numeric, comment text, created_by uuid, created_at timestamptz default now(), unique (club_id, date));
    create index idx_cash_entries_club_date on public.daily_cash_entries (club_id, date);
    create table public.daily_stock_counts (id uuid default gen_random_uuid(), club_id uuid, date date, product_id uuid, bar_income numeric, unique (date, product_id), constraint daily_stock_counts_club_date_product_key unique (club_id, date, product_id));
    create index idx_stock_counts_club_date on public.daily_stock_counts (club_id, date);
    create table public.expenses (id uuid default gen_random_uuid(), club_id uuid, date date, amount numeric, category text, payment_method text, payment_source text, comment text, created_by uuid, created_at timestamptz default now());
    create table public.new_debts (id uuid primary key default gen_random_uuid(), club_id uuid, date date not null default current_date, amount numeric);
    create table public.debt_payments (id uuid default gen_random_uuid(), club_id uuid, debt_id uuid, date date not null default current_date, amount numeric, payment_method text, comment text, created_at timestamptz default now());
    create table public.stock_purchases (id uuid default gen_random_uuid(), club_id uuid, date date, quantity numeric, cost_price numeric, created_at timestamptz default now());
    alter table public.stock_purchases enable row level security;
    grant select on public.stock_purchases to authenticated;
    insert into public.stock_purchases (club_id, date) values ('${club}', '2026-10-01'), ('${otherClub}', '2026-10-01');
    -- 014's policy pair: a feature read policy (simplified) plus the FOR ALL role policy.
    create policy "club_read_stock_purchases" on public.stock_purchases for select to authenticated
      using (club_id in (select club_id from public.club_memberships where user_id = (select auth.uid()) and role = 'owner'));
    create policy "club_admin_write_stock_purchases" on public.stock_purchases
      for all using (public.current_user_club_role(club_id) in ('admin', 'owner'))
      with check (public.current_user_club_role(club_id) in ('admin', 'owner'));
    create table public.salary_employees (id uuid default gen_random_uuid(), club_id uuid, name text);
    create table public.salary_rates (id uuid default gen_random_uuid(), club_id uuid, employee_id uuid);
    create table public.salary_entries (id uuid default gen_random_uuid(), club_id uuid, employee_id uuid, amount numeric);
    alter table public.salary_employees enable row level security;
    alter table public.salary_rates enable row level security;
    alter table public.salary_entries enable row level security;
    grant select on public.salary_employees, public.salary_rates, public.salary_entries to authenticated;
    insert into public.salary_employees (club_id, name) values ('${club}', 'A'), ('${otherClub}', 'B');
    insert into public.salary_rates (club_id) values ('${club}'), ('${otherClub}');
    insert into public.salary_entries (club_id) values ('${club}'), ('${otherClub}');
    create policy salary_employees_member_read on public.salary_employees for select to authenticated using (public.current_user_club_role(club_id) is not null);
    create policy salary_rates_member_read on public.salary_rates for select to authenticated using (public.current_user_club_role(club_id) is not null);
    create policy salary_entries_member_read on public.salary_entries for select to authenticated using (public.current_user_club_role(club_id) is not null);
    create table public.monthly_average_income_snapshots (club_id uuid, month date);
    create function public.refresh_monthly_average_income_snapshot(p_month date) returns void language sql as $$ select null::void $$;
    create function public.get_monthly_average_income_chart(p_club_id uuid, p_business_date date) returns table (month date) language sql as $$ select null::date $$;
    create function public.seed_balances_for_club() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger trg_seed_balances_for_club after insert on public.clubs for each row execute function public.seed_balances_for_club();
    grant select on public.profiles, public.daily_cash_entries, public.daily_stock_counts, public.expenses, public.debt_payments to authenticated;
    insert into public.daily_stock_counts (club_id, date, product_id, bar_income) values
      ('${club}', '2026-10-01', '20000000-0000-0000-0000-000000000001', 100),
      ('${club}', '2026-10-01', '20000000-0000-0000-0000-000000000002', 50),
      ('${club}', '2026-10-02', '20000000-0000-0000-0000-000000000001', 25);
  `);
  for (const userId of [owner, admin, viewer, outsider]) {
    purchaseBaseline.set(userId, await visibleClubs(userId, 'stock_purchases'));
  }
  await db.exec(migration);
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('migration 081 cost and index cleanup (PostgreSQL)', () => {
  it('keeps the stock purchase visibility union of 014 without a FOR ALL policy', async () => {
    for (const userId of [owner, admin, viewer, outsider]) {
      expect(await visibleClubs(userId, 'stock_purchases'), userId).toEqual(purchaseBaseline.get(userId));
    }
    const policies = await db.query<{ policyname: string; cmd: string }>(
      "select policyname, cmd from pg_policies where tablename = 'stock_purchases' order by policyname",
    );
    expect(policies.rows).toEqual([
      { policyname: 'club_read_stock_purchases', cmd: 'SELECT' },
      { policyname: 'club_role_read_stock_purchases', cmd: 'SELECT' },
    ]);
  });

  it('shows payroll rows to members of the club only', async () => {
    for (const table of ['salary_employees', 'salary_rates', 'salary_entries']) {
      expect(await visibleClubs(viewer, table), table).toEqual([club]);
      expect(await visibleClubs(outsider, table), table).toEqual([otherClub]);
    }
    const policy = await db.query<{ qual: string }>(
      "select qual from pg_policies where policyname = 'salary_entries_member_read'",
    );
    expect(policy.rows[0].qual).toContain('current_user_member_clubs()');
    expect(policy.rows[0].qual).not.toContain('current_user_club_role');
  });

  it('adds the debt-payment and receipt indexes and drops the redundant ones', async () => {
    const indexes = (await db.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public' order by indexname",
    )).rows.map((row) => row.indexname);
    expect(indexes).toContain('idx_debt_payments_club_debt_date');
    expect(indexes).toContain('idx_stock_purchases_club_created_at');
    expect(indexes).not.toContain('idx_cash_entries_club_date');
    expect(indexes).not.toContain('idx_stock_counts_club_date');
    expect(indexes).not.toContain('daily_stock_counts_date_product_id_key');
    expect(indexes).toContain('daily_stock_counts_club_date_product_key');
  });

  it('removes the calendar-date defaults from the debt ledgers', async () => {
    const defaults = await db.query<{ table_name: string; column_default: string | null }>(
      "select table_name, column_default from information_schema.columns where table_schema = 'public' and column_name = 'date' and table_name in ('new_debts','debt_payments') order by table_name",
    );
    expect(defaults.rows).toEqual([
      { table_name: 'debt_payments', column_default: null },
      { table_name: 'new_debts', column_default: null },
    ]);
  });

  it('retires the monthly average snapshot and the balances seed trigger', async () => {
    expect((await db.query("select to_regclass('public.monthly_average_income_snapshots') as t")).rows).toEqual([{ t: null }]);
    const functions = await db.query<{ proname: string }>(
      "select proname from pg_proc where proname in ('get_monthly_average_income_chart','refresh_monthly_average_income_snapshot')",
    );
    expect(functions.rows).toEqual([]);
    const triggers = await db.query("select tgname from pg_trigger where tgname = 'trg_seed_balances_for_club'");
    expect(triggers.rows).toEqual([]);
  });

  it('returns one bar sales row per day from the money report', async () => {
    const snapshot = await asUser(owner, async () => (await db.query<{ snapshot: { barSales: Array<{ date: string; bar_income: number }> } }>(
      `select public.get_money_report_snapshot('${club}', '2026-10-01', '2026-10-31') as snapshot`,
    )).rows[0].snapshot);
    expect(snapshot.barSales).toEqual([
      { date: '2026-10-01', bar_income: 150 },
      { date: '2026-10-02', bar_income: 25 },
    ]);
  });
});
