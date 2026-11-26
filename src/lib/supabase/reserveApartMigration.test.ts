import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase } from './__tests__/snapshotDatabase';

/** Migration 156 on the full replayed schema: reserve purchases and moves kept apart from money left. */

const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const stranger = '00000000-0000-0000-0000-000000000003';
const club = '10000000-0000-0000-0000-000000000001';
const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

beforeAll(async () => {
  db = await fullSchemaDatabase();
  await db.exec(`
    insert into auth.users values ('${owner}','o@x.test'), ('${admin}','a@x.test'), ('${stranger}','s@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    update public.clubs set enabled_payment_methods = array['cash','terminal'] where id = '${club}';
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner'), ('${club}','${admin}','admin');
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',1000,200,0,0,'${owner}');
    -- Supabase's default table privileges; RLS and triggers still decide.
    grant select, insert on public.expenses to authenticated;
    -- The money report snapshot reads as the caller (RLS still decides).
    grant select on all tables in schema public to authenticated;
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

const aug = '2024-08-01';
const call = <T = unknown>(sql: string, params: unknown[], userId = owner) => asUser(userId, () => db.query<T>(sql, params));
const deposit = (n: number, amount: number, method: string | null = 'cash', source = 'game_club', userId = owner) => call(
  'select move_owner_profit_to_reserve($1,$2,$3,$4,$5,$6,$7) as created', [club, id(n), aug, source, method, amount, 'For new PCs'], userId,
);
const giveBack = (n: number, amount: number, method: string | null = 'cash') => call(
  'select return_owner_reserve($1,$2,$3,$4,$5,$6,$7)', [club, id(n), aug, 'game_club', method, amount, null],
);
const purchase = (n: number, amount: number, userId = owner, method = 'cash') => call(
  `insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by, paid_from_reserve)
   values ($1,$2,'2024-08-05',$3,'equipment',$4,'game_club','Two new gaming PCs for hall',$5,true)`, [id(n), club, amount, method, userId], userId,
);

const moves = (userId = owner) => call<{ moves: Array<{ date: string; source: string; method: string | null; amount: number }> }>(
  'select get_reserve_moves($1,$2,$3) as moves', [club, '2024-08-01', '2024-08-31'], userId,
);

describe('reserve kept apart from money left (156)', () => {
  it('lists deposits, returns and dollar exchanges for any club member, never for outsiders', async () => {
    await deposit(1, 300, 'cash');
    await giveBack(2, 100, 'cash');
    await call(
      'select record_money_exchange($1,$2,$3,$4,$5,$6,$7,$8)',
      [id(3), club, '2024-08-06', 'terminal', 'usd', 120, 12, 'Terminal money into dollars for parts'],
    );
    const rows = (await moves(admin)).rows[0].moves.map((move) => [move.source, move.method, Number(move.amount)]);
    expect(rows).toEqual(expect.arrayContaining([
      ['game_club', 'cash', 300],
      ['game_club', 'cash', -100],
      ['game_club', 'usd', 120],
    ]));
    expect(rows).toHaveLength(3);
    await expect(moves(stranger)).rejects.toMatchObject({ code: '42501' });
  });

  it('dates a deposit inside the profit month it belongs to', async () => {
    const dates = (await moves()).rows[0].moves.filter((move) => move.method === 'cash').map((move) => move.date);
    // Made now (after August 2024), so it lands on the month's last day.
    expect(dates).toEqual(['2024-08-31', '2024-08-31']);
  });

  it('returns paid_from_reserve with the money report expenses', async () => {
    await purchase(10, 150);
    const payload = (await call<{ snapshot: { expenses: Array<{ id: string; paid_from_reserve: boolean }> } }>(
      'select get_money_report_snapshot($1,$2,$3) as snapshot', [club, '2024-08-01', '2024-08-31'],
    )).rows[0].snapshot;
    expect(payload.expenses).toEqual([expect.objectContaining({ id: id(10), paid_from_reserve: true })]);
  });

  it('gives the payroll KPI what the reserve paid, so it does not lower profit before payroll', async () => {
    const snapshot = (await call<{ s: { monthlyBalances: Array<Record<string, unknown>> } }>(
      'select get_salary_profit_snapshot($1,$2) as s', [club, '2024-08-31'],
    )).rows[0].s;
    const august = snapshot.monthlyBalances.find((row) => String(row.period_month).startsWith('2024-08'));
    expect(Number(august?.game_club_reserve_paid)).toBe(150);
    expect(Number(august?.bar_reserve_paid)).toBe(0);
  });
});
