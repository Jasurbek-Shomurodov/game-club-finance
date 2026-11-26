import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyDatabase } from './__tests__/snapshotDatabase';

const readMigration = (name: string) => readFileSync(resolve(process.cwd(), 'migrations', name), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const club = '10000000-0000-0000-0000-000000000001';
const month = '2024-08-01';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const withdrawByMethod = (method: string, amount: number, userId = owner) => asUser(userId, () => db.query(
  'select withdraw_owner_game_club_money_by_method($1,$2,$3,$4,$5)', [club, month, method, amount, ' note '],
));

beforeAll(async () => {
  db = await emptyDatabase();
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth; grant usage on schema public, auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.user_role as enum ('owner','admin','viewer');
    create table public.club_memberships (club_id uuid, user_id uuid, role public.user_role);
    insert into public.club_memberships values ('${club}','${owner}','owner'),('${club}','${admin}','admin');
    create function public.current_user_club_role(p_club_id uuid) returns user_role language sql stable security definer set search_path=public as $$
      select role from public.club_memberships where club_id=p_club_id and user_id=auth.uid()
    $$;
    create table public.daily_cash_entries (club_id uuid, date date, cash_income numeric, terminal_income numeric, card_income numeric, playstation_income numeric);
    create table public.debt_payments (club_id uuid, date date, amount numeric, payment_method text);
    create table public.expenses (club_id uuid, date date, amount numeric, payment_method text, payment_source text);
    create table public.daily_stock_counts (club_id uuid, date date, bar_income numeric);
    create table public.stock_purchases (club_id uuid, date date, quantity numeric, cost_price numeric);
    create table public.owner_withdrawals (
      id uuid primary key default gen_random_uuid(), club_id uuid not null, period_month date not null,
      source text not null check (source in ('game_club','bar')), amount numeric not null check (amount > 0),
      comment text, created_by uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    grant select, insert, delete on public.owner_withdrawals to authenticated;
    insert into public.daily_cash_entries values ('${club}','2024-08-02',100,1000,500,40),('${club}','2024-09-02',9999,9999,9999,9999);
    insert into public.debt_payments values ('${club}','2024-08-03',60,'terminal'),('${club}','2024-08-03',5,null);
    insert into public.daily_stock_counts values ('${club}','2024-08-02',100);
    insert into public.expenses values ('${club}','2024-08-04',200,'terminal','game_club'),('${club}','2024-08-04',30,'cash','bar');
  `);
  const monthly = readMigration('029_monthly_owner_withdrawals.sql');
  const helperStart = monthly.indexOf('create function public.owner_source_earned_for_month(');
  await db.exec(monthly.slice(helperStart, monthly.indexOf('-- Internal trigger helper only', helperStart)));
  await db.exec(readMigration('051_custom_owner_withdrawals.sql'));
  await db.exec(`create trigger trg_owner_withdrawal_month_balance before insert on public.owner_withdrawals
    for each row execute function public.enforce_owner_withdrawal_month_balance();`);
  await db.exec(readMigration('066_owner_withdrawal_payment_methods.sql'));
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('owner withdrawals by payment method (066)', () => {
  it('records a Game Club withdrawal against one payment method', async () => {
    await withdrawByMethod('terminal', 800);
    const rows = (await db.query('select source, payment_method, amount, comment from owner_withdrawals')).rows;
    expect(rows).toEqual([{ source: 'game_club', payment_method: 'terminal', amount: '800', comment: 'note' }]);
  });

  it('rejects more than the method has left for the month', async () => {
    // Terminal: 1000 income + 60 debt payment - 200 expense - 800 withdrawn = 60.
    await expect(withdrawByMethod('terminal', 61)).rejects.toMatchObject({ code: '23514' });
    await withdrawByMethod('terminal', 60);
    // Unknown debt payment methods count as card: 500 + 5.
    await expect(withdrawByMethod('card', 506)).rejects.toMatchObject({ code: '23514' });
    // Bar-paid expenses do not reduce cash.
    await expect(withdrawByMethod('cash', 101)).rejects.toMatchObject({ code: '23514' });
    await expect(withdrawByMethod('playstation', 41)).rejects.toMatchObject({ code: '23514' });
  });

  it('never exceeds the overall Game Club month balance, including unassigned withdrawals', async () => {
    // Game Club month: 1640 income + 65 debt - 200 expense = 1505; 860 taken by terminal.
    await asUser(owner, () => db.query('select withdraw_owner_money_for_month($1,$2,$3,$4,$5)', [club, month, 'game_club', 600, null]));
    // Card still has 505 by method, but only 45 of Game Club profit remains.
    await expect(withdrawByMethod('card', 46)).rejects.toMatchObject({ code: '23514' });
    await withdrawByMethod('card', 45);
  });

  it('allows only owners and only valid methods', async () => {
    await expect(withdrawByMethod('cash', 1, admin)).rejects.toMatchObject({ code: '42501' });
    await expect(withdrawByMethod('crypto', 1)).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(
      `insert into owner_withdrawals (club_id, period_month, source, payment_method, amount, created_by) values ($1,$2,'bar','cash',1,$3)`,
      [club, month, owner],
    )).rejects.toThrow('owner_withdrawals_payment_method_check');
  });

  it('keeps the earnings helper out of the RPC surface', async () => {
    await expect(asUser(owner, () => db.query(
      'select owner_payment_method_earned_for_month($1,$2,$3)', [club, 'cash', month],
    ))).rejects.toMatchObject({ code: '42501' });
  });
});
