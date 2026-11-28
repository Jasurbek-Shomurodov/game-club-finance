import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase } from './__tests__/snapshotDatabase';

/** Migration 191 on the full replayed schema: at most 5 wrong /link codes per Telegram account in 15 minutes. */

const owner = '00000000-0000-0000-0000-000000000001';
const club = '10000000-0000-0000-0000-000000000001';
const guesser = 555_000_111;
const ownerTelegram = 111_222_333;
let db: PGlite;

async function asService<T>(work: () => Promise<T>): Promise<T> {
  await db.exec(`set role service_role; select set_config('request.jwt.claim.sub','',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
}

const redeem = (code: string, telegramId: number) => asService(() => db.query<{ status: string }>(
  'select owner_bot_redeem_link_code_limited($1, $2, $3) as status', [code, telegramId, null],
)).then((result) => result.rows[0].status);

const newCode = () => asUser(owner, () => db.query<{ code: string }>('select code from create_owner_telegram_link_code()'))
  .then((result) => result.rows[0].code);

const failures = (telegramId: number) => db.query<{ failures: number }>(
  'select failures from owner_bot_link_throttle where telegram_user_id = $1', [telegramId],
).then((result) => result.rows[0]?.failures ?? null);

beforeAll(async () => {
  db = await fullSchemaDatabase();
  await db.exec(`
    alter role service_role bypassrls;
    insert into auth.users values ('${owner}','o@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Square');
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner');
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('owner bot /link throttle (191)', () => {
  it('stops a Telegram account after 5 wrong codes, even with a right one', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await redeem('ZZZZZZZZ', guesser)).toBe('invalid');
    }
    expect(await failures(guesser)).toBe(5);
    const code = await newCode();
    expect(await redeem(code, guesser)).toBe('rate_limited');
    // The refused try neither counts nor uses the code.
    expect(await failures(guesser)).toBe(5);
    expect((await db.query('select used_at from owner_telegram_link_codes where code = $1', [code])).rows).toEqual([{ used_at: null }]);
  });

  it('opens a new window 15 minutes after the last one began', async () => {
    await db.query("update owner_bot_link_throttle set window_started_at = now() - interval '16 minutes' where telegram_user_id = $1", [guesser]);
    expect(await redeem('ZZZZZZZZ', guesser)).toBe('invalid');
    expect(await failures(guesser)).toBe(1);
  });

  it('counts only wrong codes, per Telegram account', async () => {
    const code = await newCode();
    expect(await redeem(code, ownerTelegram)).toBe('linked');
    expect(await redeem(code, ownerTelegram)).toBe('linked');
    expect(await failures(ownerTelegram)).toBe(0);
    expect(await failures(guesser)).toBe(1);
  });

  it('keeps the throttle and its function away from browser roles', async () => {
    await expect(asUser(owner, () => db.query('select * from owner_bot_link_throttle'))).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(owner, () => db.query('select owner_bot_redeem_link_code_limited($1, $2, $3)', ['ZZZZZZZZ', 9, null])))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('refuses a missing Telegram id', async () => {
    await expect(redeem('ZZZZZZZZ', 0)).rejects.toMatchObject({ code: '22023' });
  });
});
