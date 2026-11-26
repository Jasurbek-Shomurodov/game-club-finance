import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase } from './__tests__/snapshotDatabase';

/** Migration 146 on the full replayed schema: a payment method never goes negative on any day. */

const owner = '00000000-0000-0000-0000-000000000001';
const club = '10000000-0000-0000-0000-000000000001';
const income = '30000000-0000-0000-0000-000000000001';
const note = ' paid for the club this week ';
let db: PGlite;
let nextId = 1;
const newId = () => `20000000-0000-0000-0000-${String(nextId++).padStart(12, '0')}`;

/** Writes as a signed-in user: the triggers read auth.uid() from the request claim. */
async function signedIn<T>(work: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);
  try { return await work(); } finally { await db.exec(`select set_config('request.jwt.claim.sub','',false)`); }
}

const expense = (date: string, amount: number, method = 'cash', source = 'game_club') => {
  const id = newId();
  return signedIn(() => db.query(
    `insert into expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by)
     values ($1,$2,$3,$4,'supplies',$5,$6,$7,$8)`,
    [id, club, date, amount, method, source, note, owner],
  )).then(() => id);
};
const exchange = (date: string, from: string, to: string, amount: number) => {
  const id = newId();
  return signedIn(() => db.query(
    `insert into money_exchanges (id, club_id, date, from_method, to_method, from_amount, to_amount, comment, created_by)
     values ($1,$2,$3,$4,$5,$6,$6,$7,$8)`,
    [id, club, date, from, to, amount, note, owner],
  )).then(() => id);
};
const refused = { message: expect.stringMatching(/insufficient payment method balance/i), code: 'P0001' };

beforeAll(async () => {
  db = await fullSchemaDatabase();
  await db.exec(`
    insert into auth.users values ('${owner}','o@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner');
    insert into public.daily_cash_entries (id, club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${income}','${club}','2024-08-10',1000000,0,0,0,'${owner}');
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('a payment method never goes negative on any day (146)', () => {
  it('refuses spending on a day before the money arrived, though the month adds up', async () => {
    await expect(expense('2024-08-05', 100)).rejects.toMatchObject(refused);
    await expect(exchange('2024-08-09', 'cash', 'card', 100)).rejects.toMatchObject(refused);
  });

  it('allows spending what the day holds and nothing more', async () => {
    await expense('2024-08-10', 600_000);
    await expense('2024-08-12', 400_000);
    await expect(expense('2024-08-12', 1)).rejects.toMatchObject(refused);
  });

  it('refuses a change that spends more or earlier, but not a smaller one', async () => {
    const id = await expense('2024-08-20', 0.01).catch(() => null);
    expect(id).toBeNull();
    const [first] = (await db.query<{ id: string }>(`select id from expenses where date = '2024-08-12'`)).rows;
    await expect(signedIn(() => db.query('update expenses set amount = 400001 where id = $1', [first.id]))).rejects.toMatchObject(refused);
    await signedIn(() => db.query('update expenses set amount = 300000 where id = $1', [first.id]));
    await expect(signedIn(() => db.query(`update expenses set date = '2024-08-01' where id = $1`, [first.id]))).rejects.toMatchObject(refused);
  });

  it('refuses taking back income that was already spent', async () => {
    // 1 000 000 collected, 900 000 spent: 100 000 left.
    await expect(signedIn(() => db.query('update daily_cash_entries set cash_income = 899999 where id = $1', [income])))
      .rejects.toMatchObject(refused);
    await expect(signedIn(() => db.query('delete from daily_cash_entries where id = $1', [income]))).rejects.toMatchObject(refused);
    await expect(signedIn(() => db.query(`update daily_cash_entries set date = '2024-08-11' where id = $1`, [income])))
      .rejects.toMatchObject(refused);
    await signedIn(() => db.query('update daily_cash_entries set cash_income = 900000 where id = $1', [income]));
  });

  it('refuses deleting an exchange whose money moved on', async () => {
    await signedIn(() => db.query('update daily_cash_entries set cash_income = 1000000 where id = $1', [income]));
    const toCard = await exchange('2024-08-13', 'cash', 'card', 100_000);
    await expense('2024-08-14', 100_000, 'card');
    await expect(signedIn(() => db.query('delete from money_exchanges where id = $1', [toCard]))).rejects.toMatchObject(refused);
  });

  it('does not limit Bar expenses, server jobs, or days before the write', async () => {
    await expense('2024-08-01', 500, 'cash', 'bar');
    await db.query(
      `insert into expenses (club_id, date, amount, category, payment_method, comment, created_by)
       values ($1,'2024-08-02',50,'supplies','cash',$2,$3)`,
      [club, note, owner],
    );
    // 2 to 13 Aug are now negative by 50 (a server write is not checked), but a
    // write dated later only checks its own day on.
    await signedIn(() => db.query(
      `insert into daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
       values ($1,'2024-08-20',100,0,0,0,$2)`,
      [club, owner],
    ));
    await expense('2024-08-20', 10);
  });

  it('collects a day even when the method is short, without touching the reserve (148)', async () => {
    const result = await signedIn(() => db.query<{ ticked: boolean }>(
      'select mark_daily_cash_collected($1, $2) as ticked', [club, '2024-08-20'],
    ));
    expect(result.rows[0].ticked).toBe(true);
    const deposits = await db.query(`select 1 from owner_reserve_entries where collection_date = '2024-08-20'`);
    expect(deposits.rows).toEqual([]);
  });
});

