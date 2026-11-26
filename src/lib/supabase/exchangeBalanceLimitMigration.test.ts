import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase } from './__tests__/snapshotDatabase';

/** Migrations 144 and 145 on the full replayed schema: an exchange, or deleting one, cannot leave a method negative. */

const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const club = '10000000-0000-0000-0000-000000000001';
const note = ' changed money for the new console ';
let db: PGlite;
let nextId = 1;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const exchange = (date: string, from: string, to: string, amount: number, rate: number | null = null, userId = admin) => {
  const id = `20000000-0000-0000-0000-${String(nextId++).padStart(12, '0')}`;
  return asUser(userId, () => db.query(
    'select * from record_money_exchange($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, club, date, from, to, amount, rate, note],
  ));
};
const removeExchange = (id: string, userId = owner) => asUser(userId, () => db.query(
  'select delete_money_exchange($1,$2)', [club, id],
));
const exchangeId = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const exchangeCount = async () => Number((await db.query<{ n: string }>('select count(*) n from money_exchanges')).rows[0].n);

beforeAll(async () => {
  db = await fullSchemaDatabase();
  await db.exec(`
    insert into auth.users values ('${owner}','o@x.test'),('${admin}','a@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner'),('${club}','${admin}','admin');
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',1000000,0,0,0,'${owner}');
    insert into public.expenses (club_id, date, amount, category, payment_method, comment, created_by)
      values ('${club}','2024-08-03',400000,'supplies','cash','${note}','${admin}');
    grant select on all tables in schema public to authenticated;
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('exchange balance limit (144)', () => {
  it('refuses an exchange larger than the method holds, for owners too', async () => {
    // 1 000 000 collected minus a 400 000 cash expense.
    await expect(exchange('2024-08-05', 'cash', 'card', 600_001)).rejects.toMatchObject({
      message: expect.stringMatching(/insufficient payment method balance/i),
      code: 'P0001',
    });
    await expect(exchange('2024-08-05', 'cash', 'usd', 1_000_000, 12_000, owner)).rejects.toMatchObject({ code: 'P0001' });
    expect(await exchangeCount()).toBe(0);
  });

  it('allows exactly what the method holds and then nothing more', async () => {
    await exchange('2024-08-05', 'cash', 'usd', 600_000, 12_000);
    await expect(exchange('2024-08-05', 'cash', 'card', 1)).rejects.toMatchObject({ code: 'P0001' });
    expect(await exchangeCount()).toBe(1);
  });

  it('limits dollars to the dollars still held', async () => {
    await expect(exchange('2024-08-06', 'usd', 'cash', 50.01, 12_000)).rejects.toMatchObject({ code: 'P0001' });
    await exchange('2024-08-06', 'usd', 'cash', 50, 12_000);
    expect(await exchangeCount()).toBe(2);
  });

  it('counts money exchanged in: the received cash can be spent or exchanged again', async () => {
    // 50 dollars came back as 600 000 cash.
    await exchange('2024-08-07', 'cash', 'card', 600_000);
    await expect(exchange('2024-08-07', 'cash', 'card', 1)).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('deleting an exchange (145)', () => {
  // By now: cash 1 000 000 - 400 000 expense - 600 000 into dollars
  // + 600 000 back from 50 dollars - 600 000 to card = 0. Card holds 600 000, dollars 0.
  it('is still for owners only', async () => {
    await expect(removeExchange(exchangeId(7), admin)).rejects.toMatchObject({ code: '42501' });
  });

  it('refuses when the money it brought in was already spent or exchanged again', async () => {
    // Saved exchanges (refused attempts use ids too): 3 cash -> 50 dollars,
    // 6 those 50 dollars -> cash, 7 that cash -> card.
    // The dollars bought (exchange 3) were sold again (exchange 6): none are left to take back.
    await expect(removeExchange(exchangeId(3))).rejects.toMatchObject({
      message: expect.stringMatching(/insufficient payment method balance/i),
      code: 'P0001',
    });
    // The cash from selling dollars (exchange 6) went on to the card (exchange 7).
    await expect(removeExchange(exchangeId(6))).rejects.toMatchObject({ code: 'P0001' });
    expect(await exchangeCount()).toBe(3);
  });

  it('allows it once the later money movement is undone, in reverse order', async () => {
    await removeExchange(exchangeId(7));
    await removeExchange(exchangeId(6));
    await removeExchange(exchangeId(3));
    expect(await exchangeCount()).toBe(0);
  });

  it('still says when the exchange is not the club\'s', async () => {
    await expect(removeExchange(exchangeId(99))).rejects.toMatchObject({ code: 'P0002' });
  });
});
