import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase } from './__tests__/snapshotDatabase';

/** Migration 151 on the full replayed schema: a shortage never exceeds what its month still has. */

const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const club = '10000000-0000-0000-0000-000000000001';
const employee = '30000000-0000-0000-0000-000000000001';
const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const note = 'Cash was missing at the evening handover';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

beforeAll(async () => {
  db = await fullSchemaDatabase();
  await db.exec(`
    insert into auth.users values ('${owner}','o@x.test'), ('${admin}','a@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    update public.clubs set enabled_payment_methods = array['cash','terminal'] where id = '${club}';
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner'), ('${club}','${admin}','admin');
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',10000,3000,0,0,'${owner}');
    insert into public.salary_employees (id, club_id, name, joined_on, created_by)
      values ('${employee}','${club}','Izzat','2024-01-01','${owner}');
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

const record = (n: number, amount: number, options: { date?: string; method?: string; source?: string } = {}) => asUser(owner, () => db.query(
  'select record_cash_shortage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
  [club, id(n), options.date ?? '2024-08-03', options.source ?? 'game_club', options.method ?? 'cash', amount, 'stolen', null, note, 0, null],
));
const limits = (month: string) => asUser(owner, () => db.query<{ source: string; payment_method: string | null; available: string; shortage_date: string | null }>(
  'select source, payment_method, available, shortage_date::text from cash_shortage_limits($1,$2)', [club, month],
)).then((result) => Object.fromEntries(result.rows.map((row) => [
  `${row.source}:${row.payment_method ?? '-'}`, { available: Number(row.available), date: row.shortage_date },
])));

describe('cash shortage monthly limit (151)', () => {
  it('reports what each method of the month still has and the day a shortage is dated', async () => {
    const august = await limits('2024-08-01');
    expect(august['game_club:cash'].available).toBe(10000);
    expect(august['game_club:terminal'].available).toBe(3000);
    expect(august['game_club:card'].available).toBe(0);
    expect(august['bar:-'].available).toBe(0);
    expect(august['game_club:cash'].date).toBe('2024-08-31');
  });

  it('refuses more than the method has and accepts up to it', async () => {
    await expect(record(1, 10001)).rejects.toMatchObject({ hint: 'shortage_exceeds_available' });
    await expect(record(2, 3001, { method: 'terminal' })).rejects.toMatchObject({ hint: 'shortage_exceeds_available' });
    await expect(record(3, 100, { source: 'bar' })).rejects.toMatchObject({ hint: 'shortage_exceeds_available' });
    expect((await record(4, 4000)).rows).toHaveLength(1);
    expect((await limits('2024-08-01'))['game_club:cash'].available).toBe(6000);
    await expect(record(5, 6001)).rejects.toMatchObject({ hint: 'shortage_exceeds_available' });
  });

  it('dates the shortage on the latest day of the month that is not collected', async () => {
    await db.exec(`insert into public.daily_cash_collections (club_id, date, collected_by) values ('${club}','2024-08-31','${owner}'), ('${club}','2024-08-30','${owner}')`);
    expect((await limits('2024-08-01'))['game_club:cash'].date).toBe('2024-08-29');
  });

  it('is owner-only', async () => {
    await expect(asUser(admin, () => db.query('select * from cash_shortage_limits($1,$2)', [club, '2024-08-01'])))
      .rejects.toMatchObject({ code: '42501' });
  });
});
