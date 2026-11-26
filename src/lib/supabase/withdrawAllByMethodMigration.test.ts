import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase } from './__tests__/snapshotDatabase';

/** Migration 142 on the full replayed schema: "All" withdrawals take Game Club money method by method. */

const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const club = '10000000-0000-0000-0000-000000000001';
const month = '2024-08-01';
const note = ' took the monthly profit home today ';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const withdrawAll = (amount: number, userId = owner) => asUser(userId, () => db.query(
  'select withdraw_owner_money_all_by_method($1,$2,$3,$4)', [club, month, amount, note],
));
const rows = async () => (await db.query<{ source: string; payment_method: string | null; amount: string }>(
  'select source, payment_method, amount from owner_withdrawals order by created_at, payment_method',
)).rows;

beforeAll(async () => {
  db = await fullSchemaDatabase();
  await db.exec(`
    insert into auth.users values ('${owner}','o@x.test'),('${admin}','a@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner'),('${club}','${admin}','admin');
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',1265000,0,500,700,'${owner}');
    grant select on all tables in schema public to authenticated;
  `);
  // All the cash goes into dollars: it stays Game Club profit, but no method holds it.
  await asUser(owner, () => db.query(
    'select * from record_money_exchange($1,$2,$3,$4,$5,$6,$7,$8)',
    ['20000000-0000-0000-0000-000000000001', club, '2024-08-05', 'cash', 'usd', 1_265_000, 12_650, ' changed money for the rent '],
  ));
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('withdrawing from all sources by method (142)', () => {
  it('is for club owners only', async () => {
    await expect(withdrawAll(100, admin)).rejects.toMatchObject({ code: '42501' });
  });

  it('never takes money held in dollars', async () => {
    // Game Club profit is 1 266 200, but the methods hold only card 500 + PlayStation 700.
    await expect(withdrawAll(1_201)).rejects.toMatchObject({ code: '23514' });
    expect(await rows()).toEqual([]);
  });

  it('takes each method in turn and names it on every row', async () => {
    await withdrawAll(600);
    expect(await rows()).toEqual([
      { source: 'game_club', payment_method: 'card', amount: '500' },
      { source: 'game_club', payment_method: 'playstation', amount: '100' },
    ]);
    await withdrawAll(600);
    await expect(withdrawAll(1)).rejects.toMatchObject({ code: '23514' });
    expect((await rows()).filter((row) => row.payment_method === 'playstation').map((row) => row.amount))
      .toEqual(['100', '600']);
  });
});
