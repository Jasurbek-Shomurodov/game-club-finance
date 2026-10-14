import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const readMigration = (name: string) => readFileSync(resolve(process.cwd(), 'migrations', name), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const outsider = '00000000-0000-0000-0000-000000000009';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

type Snapshot = { withdrawalRows: Array<Record<string, unknown>> } & Record<string, unknown>;

const snapshot = (fn: string, userId = owner) => asUser(userId, async () => (
  await db.query<{ snapshot: Snapshot }>(`select public.${fn}($1, $2) as snapshot`, [club, '2024-09-15'])
).rows[0].snapshot);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth; grant usage on schema public, auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.user_has_club_access(p_club_id uuid) returns boolean language sql stable as $$
      select auth.uid() = '${owner}'::uuid
    $$;
    create table public.daily_cash_entries (club_id uuid, date date, cash_income numeric, terminal_income numeric, card_income numeric, playstation_income numeric);
    create table public.debt_payments (club_id uuid, date date, amount numeric, payment_method text);
    create table public.expenses (club_id uuid, date date, amount numeric, payment_method text, payment_source text);
    create table public.daily_stock_counts (club_id uuid, date date, bar_income numeric);
    create table public.stock_purchases (club_id uuid, date date, quantity numeric, cost_price numeric);
    create table public.owner_withdrawals (
      id uuid primary key default gen_random_uuid(), club_id uuid not null, period_month date not null,
      source text not null, payment_method text, amount numeric not null, comment text, created_by uuid,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    grant select on all tables in schema public to authenticated;
    insert into public.daily_cash_entries values ('${club}','2024-08-02',100,1000,500,40);
    insert into public.owner_withdrawals (club_id, period_month, source, payment_method, amount, created_at) values
      ('${club}','2024-08-01','game_club','terminal',300,'2024-08-10'),
      ('${club}','2024-08-01','game_club',null,50,'2024-08-11'),
      ('${club}','2024-09-01','bar',null,20,'2024-09-02'),
      ('${club}','2024-10-01','bar',null,99,'2024-10-02'),
      ('${otherClub}','2024-08-01','game_club','cash',77,'2024-08-12');
  `);
  await db.exec(readMigration('050_owner_profit_monthly_payment_balances.sql'));
  await db.exec(readMigration('076_owner_profit_snapshot_withdrawal_methods.sql'));
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('owner profit snapshot with withdrawal methods (076)', () => {
  it('leaves the fingerprinted 050 snapshot untouched', () => {
    expect(readMigration('076_owner_profit_snapshot_withdrawal_methods.sql'))
      .not.toMatch(/function\s+public\.get_owner_profit_snapshot\s*\(/);
  });

  it('returns the 050 payload with each withdrawal payment method added', async () => {
    const base = await snapshot('get_owner_profit_snapshot');
    const withMethods = await snapshot('get_owner_profit_snapshot_with_methods');

    const { withdrawalRows: baseRows, ...baseRest } = base;
    const { withdrawalRows, ...rest } = withMethods;
    expect(rest).toEqual(baseRest);
    expect(withdrawalRows.map((row) => {
      const copy = { ...row };
      delete copy.payment_method;
      return copy;
    })).toEqual(baseRows);
    expect(withdrawalRows.map((row) => [row.period_month, row.source, row.payment_method])).toEqual([
      ['2024-09-01', 'bar', null],
      ['2024-08-01', 'game_club', null],
      ['2024-08-01', 'game_club', 'terminal'],
    ]);
  });

  it('still refuses callers without club access', async () => {
    await expect(snapshot('get_owner_profit_snapshot_with_methods', outsider)).rejects.toThrow('Not authorized for this club.');
  });

  it('is not executable by anonymous callers', async () => {
    const { rows } = await db.query<{ allowed: boolean }>(
      "select has_function_privilege('anon', 'public.get_owner_profit_snapshot_with_methods(uuid,date)', 'EXECUTE') as allowed",
    );
    expect(rows).toEqual([{ allowed: false }]);
  });
});
