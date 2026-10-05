import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const readMigration = (name: string) => readFileSync(resolve(process.cwd(), 'migrations', name), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const august = '2024-08-01';
const september = '2024-09-01';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const carry = (month: string, source: string, method: string | null, amount: number, userId = owner) => asUser(userId, async () => (
  await db.query<{ id: string }>(
    'select carry_owner_profit_to_next_month($1,$2,$3,$4,$5,$6) as id', [club, month, source, method, amount, ' moved '],
  )
).rows[0].id);
const withdraw = (month: string, source: string, amount: number) => asUser(owner, () => db.query(
  'select withdraw_owner_money_for_month($1,$2,$3,$4,$5)', [club, month, source, amount, null],
));
const withdrawByMethod = (month: string, method: string, amount: number) => asUser(owner, () => db.query(
  'select withdraw_owner_game_club_money_by_method($1,$2,$3,$4,$5)', [club, month, method, amount, null],
));
const deleteCarryover = (id: string, userId = owner) => asUser(userId, () => db.query(
  'select delete_owner_profit_carryover($1,$2)', [club, id],
));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth; grant usage on schema public, auth to authenticated, anon;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${owner}'),('${admin}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.user_role as enum ('owner','admin','viewer');
    create table public.clubs (id uuid primary key);
    insert into public.clubs values ('${club}'),('${otherClub}');
    create table public.club_memberships (club_id uuid, user_id uuid, role public.user_role);
    insert into public.club_memberships values ('${club}','${owner}','owner'),('${club}','${admin}','admin');
    create function public.current_user_club_role(p_club_id uuid) returns user_role language sql stable security definer set search_path=public as $$
      select role from public.club_memberships where club_id=p_club_id and user_id=auth.uid()
    $$;
    create function public.current_user_readable_clubs(p_feature_keys text[]) returns setof uuid language sql stable security definer set search_path=public as $$
      select club_id from public.club_memberships where user_id=auth.uid()
    $$;
    grant execute on function public.current_user_readable_clubs(text[]) to authenticated;
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
    -- August: Game Club 1000 (cash 400, terminal 600), Bar 300. September: Game Club cash 100, no Bar.
    insert into public.daily_cash_entries values ('${club}','2024-08-02',400,600,0,0),('${club}','2024-09-02',100,0,0,0);
    insert into public.daily_stock_counts values ('${club}','2024-08-02',300);
  `);
  const monthly = readMigration('029_monthly_owner_withdrawals.sql');
  const helperStart = monthly.indexOf('create function public.owner_source_earned_for_month(');
  await db.exec(monthly.slice(helperStart, monthly.indexOf('-- Internal trigger helper only', helperStart)));
  await db.exec(readMigration('051_custom_owner_withdrawals.sql'));
  await db.exec(`create trigger trg_owner_withdrawal_month_balance before insert on public.owner_withdrawals
    for each row execute function public.enforce_owner_withdrawal_month_balance();`);
  await db.exec(readMigration('066_owner_withdrawal_payment_methods.sql'));
  await db.exec(readMigration('071_owner_profit_carryovers.sql'));
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('owner profit carryovers (071)', () => {
  let barCarryover = '';
  let cashCarryover = '';

  it('moves unwithdrawn profit into the next month', async () => {
    await withdraw(august, 'bar', 100);
    barCarryover = await carry(august, 'bar', null, 200);
    const rows = (await db.query('select from_month::text, to_month::text, source, payment_method, amount, comment from owner_profit_carryovers')).rows;
    expect(rows).toEqual([{ from_month: august, to_month: september, source: 'bar', payment_method: null, amount: '200', comment: 'moved' }]);

    // August Bar is used up; September Bar can now be withdrawn though it earned nothing.
    await expect(withdraw(august, 'bar', 1)).rejects.toMatchObject({ code: '23514' });
    await expect(withdraw(september, 'bar', 201)).rejects.toMatchObject({ code: '23514' });
  });

  it('moves Game Club money by payment method and caps it by that method', async () => {
    await expect(carry(august, 'game_club', 'cash', 401)).rejects.toMatchObject({ code: '23514' });
    cashCarryover = await carry(august, 'game_club', 'cash', 400);
    await expect(withdrawByMethod(august, 'cash', 1)).rejects.toMatchObject({ code: '23514' });
    // September cash: 100 earned + 400 carried in.
    await expect(withdrawByMethod(september, 'cash', 501)).rejects.toMatchObject({ code: '23514' });
    await withdrawByMethod(september, 'cash', 450);
    // August Game Club still has terminal money: 1000 - 400 carried.
    await withdraw(august, 'game_club', 600);
  });

  it('refuses to undo a carryover whose money was already used next month', async () => {
    // September cash has 50 left of the 400 carried in.
    await expect(deleteCarryover(cashCarryover)).rejects.toMatchObject({ code: '23514' });
    await deleteCarryover(barCarryover);
    expect((await db.query('select count(*)::int as n from owner_profit_carryovers')).rows).toEqual([{ n: 1 }]);
    await withdraw(august, 'bar', 200);
  });

  it('rejects invalid requests and non-owners', async () => {
    await expect(carry(august, 'bar', null, 1, admin)).rejects.toMatchObject({ code: '42501' });
    await expect(carry(august, 'all', null, 1)).rejects.toMatchObject({ code: '23514' });
    await expect(carry(august, 'game_club', null, 1)).rejects.toMatchObject({ code: '23514' });
    await expect(carry(august, 'bar', 'cash', 1)).rejects.toMatchObject({ code: '23514' });
    await expect(carry('2024-08-15', 'bar', null, 1)).rejects.toMatchObject({ code: '23514' });
    await expect(carry('2999-01-01', 'bar', null, 1)).rejects.toMatchObject({ code: '22008' });
    await expect(deleteCarryover(cashCarryover, admin)).rejects.toMatchObject({ code: '42501' });
  });

  it('allows reads only and keeps helpers out of the RPC surface', async () => {
    expect((await asUser(owner, () => db.query('select id from owner_profit_carryovers'))).rows).toHaveLength(1);
    await expect(asUser(owner, () => db.query(
      `insert into owner_profit_carryovers (club_id, from_month, source, amount) values ('${club}','${august}','bar',1)`,
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(owner, () => db.query('delete from owner_profit_carryovers'))).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(owner, () => db.query(
      'select owner_profit_bucket_available($1,$2,$3,$4)', [club, 'bar', null, august],
    ))).rejects.toMatchObject({ code: '42501' });
  });
});
