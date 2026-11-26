import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase } from './__tests__/snapshotDatabase';

/** Migration 143 on the full replayed schema: the owner reserve holds the club's dollars. */

const owner = '00000000-0000-0000-0000-000000000001';
const club = '10000000-0000-0000-0000-000000000001';
const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const aug = '2024-08-01';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

beforeAll(async () => {
  db = await fullSchemaDatabase();
  await db.exec(`
    insert into auth.users values ('${owner}','o@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner');
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',2000000,0,0,90000,'${owner}');
    grant select on all tables in schema public to authenticated;
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

const exchange = (n: number, from: string, to: string, amount: number, rate: number) => asUser(owner, () => db.query(
  'select * from record_money_exchange($1,$2,$3,$4,$5,$6,$7,$8)', [id(n), club, '2024-08-05', from, to, amount, rate, ' changed money for the rent '],
));
const num = async (sql: string, params: unknown[]) => Number(Object.values((await db.query<Record<string, string>>(sql, params)).rows[0])[0]);
const available = (method: string | null) => num('select public.owner_profit_bucket_available($1,$2,$3,$4)', [club, 'game_club', method, aug]);
const reserve = (method: string | null) => num('select public.owner_reserve_balance($1,$2,$3)', [club, 'game_club', method]);

describe('dollars in the reserve (143)', () => {
  it('puts every exchange into dollars into the reserve at once', async () => {
    expect(await available(null)).toBe(2_090_000);
    await exchange(1, 'cash', 'usd', 1_265_000, 12_650);
    // Game Club keeps only what its methods hold; the dollars are the reserve's.
    expect(await available(null)).toBe(825_000);
    expect(await available('cash')).toBe(735_000);
    expect(await reserve('usd')).toBe(1_265_000);
    expect(await reserve(null)).toBe(1_265_000);
  });

  it('lets the reserve pay dollar expenses without touching the month', async () => {
    await db.query(
      `insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by, usd_amount, usd_rate)
       values ($1,$2,'2024-08-06',632500,'rent','usd','game_club','paid the monthly hall rent in dollars',$3,50,12650)`,
      [id(2), club, owner],
    );
    expect(await available(null)).toBe(825_000);
    expect(await reserve('usd')).toBe(632_500);
    expect(await reserve('cash')).toBe(0);
  });

  it('returns dollars exchanged back to the month they came back in', async () => {
    await exchange(3, 'usd', 'cash', 10, 13_000);
    expect(await available('cash')).toBe(865_000);
    expect(await available(null)).toBe(955_000);
    expect(await reserve('usd')).toBe(502_500);
  });

  it('shows the dollars in the owner balance RPC and leaves them out of hand-made returns', async () => {
    const balances = (await asUser(owner, () => db.query<{ b: { game_club: Record<string, string | number> } }>(
      'select public.get_owner_reserve_balances($1) as b', [club],
    ))).rows[0].b.game_club;
    expect(Number(balances.usd)).toBe(502_500);
    expect(Number(balances.usd_held)).toBe(40);
    await expect(asUser(owner, () => db.query(
      'select return_owner_reserve($1,$2,$3,$4,$5,$6,$7)', [club, id(4), aug, 'game_club', 'usd', 1000, null],
    ))).rejects.toMatchObject({ code: '23514' });
  });

  it('takes a deleted exchange out of the reserve with it', async () => {
    await asUser(owner, () => db.query('select delete_money_exchange($1,$2)', [club, id(3)]));
    expect(await reserve('usd')).toBe(632_500);
    expect(await available(null)).toBe(825_000);
  });
});
