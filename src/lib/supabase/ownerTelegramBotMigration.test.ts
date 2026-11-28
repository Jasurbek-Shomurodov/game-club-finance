import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase } from './__tests__/snapshotDatabase';

/** Migration 190 on the full replayed schema: owner Telegram links, one-time codes and money handovers. */

const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const secondOwner = '00000000-0000-0000-0000-000000000003';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const closedClub = '10000000-0000-0000-0000-000000000003';
const request = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ownerTelegram = 111_222_333;
const secondTelegram = 444_555_666;
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
}

async function asService<T>(work: () => Promise<T>): Promise<T> {
  await db.exec(`set role service_role; select set_config('request.jwt.claim.sub','',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const newCode = (userId: string) => asUser(userId, () => db.query<{ code: string; expires_at: string }>(
  'select code, expires_at::text from create_owner_telegram_link_code()',
)).then((result) => result.rows[0]);

const redeem = (code: string, telegramId: number, username: string | null = 'pixel_owner') => asService(() => db.query<{ status: string }>(
  'select owner_bot_redeem_link_code($1, $2, $3) as status', [code, telegramId, username],
)).then((result) => result.rows[0].status);

beforeAll(async () => {
  db = await fullSchemaDatabase();
  await db.exec(`
    -- As on Supabase, the service role is not held back by row-level security.
    alter role service_role bypassrls;
    insert into auth.users values ('${owner}','o@x.test'), ('${admin}','a@x.test'), ('${secondOwner}','s@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Square'), ('${otherClub}', 'Algoritm'), ('${closedClub}', 'Closed');
    update public.clubs set is_active = false where id = '${closedClub}';
    insert into public.club_memberships (club_id, user_id, role) values
      ('${club}','${owner}','owner'), ('${club}','${admin}','admin'),
      ('${closedClub}','${owner}','owner'), ('${otherClub}','${secondOwner}','owner');
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('owner Telegram link codes (190)', () => {
  it('gives an owner an 8-character code valid for 15 minutes', async () => {
    const { code, expires_at: expiresAt } = await newCode(owner);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const minutes = (await db.query<{ minutes: number }>(
      'select round(extract(epoch from ($1::timestamptz - now())) / 60)::int as minutes', [expiresAt],
    )).rows[0].minutes;
    expect(minutes).toBe(15);
  });

  it('replaces the caller\'s unused codes and leaves other owners\' codes alone', async () => {
    const first = (await newCode(owner)).code;
    const other = (await newCode(secondOwner)).code;
    const second = (await newCode(owner)).code;
    const live = (await db.query<{ code: string }>('select code from owner_telegram_link_codes order by code')).rows.map((row) => row.code);
    expect(live).not.toContain(first);
    expect(live).toEqual(expect.arrayContaining([second, other]));
  });

  it('refuses someone who owns no club, and a signed-out caller', async () => {
    await expect(newCode(admin)).rejects.toMatchObject({ code: '42501' });
    await expect(asUser('', () => db.query('select * from create_owner_telegram_link_code()'))).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps the codes and the redeem function away from browser roles', async () => {
    await expect(asUser(owner, () => db.query('select * from owner_telegram_link_codes'))).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(owner, () => db.query('select owner_bot_redeem_link_code($1,$2,$3)', ['AAAAAAAA', ownerTelegram, null])))
      .rejects.toMatchObject({ code: '42501' });
    await expect(asUser(owner, () => db.query('select * from owner_bot_owner_clubs($1)', [ownerTelegram])))
      .rejects.toMatchObject({ code: '42501' });
  });
});

describe('redeeming a code in the owner bot (190)', () => {
  it('links the Telegram account once and answers a repeated delivery as linked', async () => {
    const { code } = await newCode(owner);
    expect(await redeem(` ${code.toLowerCase().slice(0, 4)}-${code.slice(4)} `, ownerTelegram, '@pixel_owner')).toBe('linked');
    expect(await redeem(code, ownerTelegram)).toBe('linked');
    expect(await redeem(code, secondTelegram)).toBe('used');
    const link = (await db.query('select user_id, telegram_user_id::int8::text as telegram, telegram_username from owner_telegram_links')).rows;
    expect(link).toEqual([{ user_id: owner, telegram: String(ownerTelegram), telegram_username: 'pixel_owner' }]);
  });

  it('refuses unknown, malformed and expired codes', async () => {
    expect(await redeem('ZZZZZZZZ', ownerTelegram)).toBe('invalid');
    expect(await redeem('1234', ownerTelegram)).toBe('invalid');
    const { code } = await newCode(secondOwner);
    await db.query("update owner_telegram_link_codes set created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes' where code = $1", [code]);
    expect(await redeem(code, secondTelegram)).toBe('expired');
  });

  it('refuses a Telegram account already linked to another user', async () => {
    const { code } = await newCode(secondOwner);
    expect(await redeem(code, ownerTelegram)).toBe('telegram_in_use');
    expect(await redeem(code, secondTelegram, null)).toBe('linked');
  });

  it('moves a user\'s own link to a new Telegram account', async () => {
    const { code } = await newCode(secondOwner);
    expect(await redeem(code, 777_888_999, 'new_phone')).toBe('linked');
    const rows = (await db.query<{ telegram: string; telegram_username: string | null }>(
      'select telegram_user_id::text as telegram, telegram_username from owner_telegram_links where user_id = $1', [secondOwner],
    )).rows;
    expect(rows).toEqual([{ telegram: '777888999', telegram_username: 'new_phone' }]);
  });

  it('refuses a code whose user no longer owns a club', async () => {
    const { code } = await newCode(secondOwner);
    // A club keeps at least one owner: hand Algoritm to the first owner for a moment.
    await db.query("insert into club_memberships (club_id, user_id, role) values ($1, $2, 'owner')", [otherClub, owner]);
    await db.query("update club_memberships set role = 'admin' where user_id = $1", [secondOwner]);
    try {
      expect(await redeem(code, 777_888_999)).toBe('not_owner');
    } finally {
      await db.query("update club_memberships set role = 'owner' where user_id = $1", [secondOwner]);
      await db.query('delete from club_memberships where club_id = $1 and user_id = $2', [otherClub, owner]);
    }
  });

  it('lists only the active clubs the linked user owns', async () => {
    const clubs = await asService(() => db.query<{ id: string; name: string }>('select id, name from owner_bot_owner_clubs($1)', [ownerTelegram]));
    expect(clubs.rows).toEqual([{ id: club, name: 'Square' }]);
    expect((await asService(() => db.query('select * from owner_bot_owner_clubs($1)', [123]))).rows).toEqual([]);
  });
});

describe('owner_telegram_links access (190)', () => {
  it('lets a user read only their own link', async () => {
    const own = await asUser(owner, () => db.query<{ user_id: string }>('select user_id from owner_telegram_links'));
    expect(own.rows).toEqual([{ user_id: owner }]);
    expect((await asUser(admin, () => db.query('select * from owner_telegram_links'))).rows).toEqual([]);
  });

  it('never lets a browser role create or change a link', async () => {
    await expect(asUser(admin, () => db.query('insert into owner_telegram_links (user_id, telegram_user_id) values ($1, 5)', [admin])))
      .rejects.toMatchObject({ code: '42501' });
    await expect(asUser(owner, () => db.query('update owner_telegram_links set telegram_user_id = 5')))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('lets a user unlink only themselves', async () => {
    const otherDelete = await asUser(owner, () => db.query('delete from owner_telegram_links where user_id = $1 returning user_id', [secondOwner]));
    expect(otherDelete.rows).toEqual([]);
    const ownDelete = await asUser(owner, () => db.query('delete from owner_telegram_links where user_id = $1 returning user_id', [owner]));
    expect(ownDelete.rows).toEqual([{ user_id: owner }]);
    expect((await db.query('select user_id from owner_telegram_links where user_id = $1', [secondOwner])).rows).toHaveLength(1);
  });
});

describe('owner_money_handovers (190)', () => {
  const insert = (values: { n: number; side?: string; method?: string | null; amount?: number; action?: string; clubId?: string }) => db.query(
    `insert into owner_money_handovers (club_id, business_date, side, payment_method, amount, action, request_id, created_by)
     values ($1, '2026-11-27', $2, $3, $4, $5, $6, $7)`,
    [values.clubId ?? club, values.side ?? 'game_club', values.method === undefined ? 'cash' : values.method,
      values.amount ?? 1_200_000, values.action ?? 'collected', request(values.n), owner],
  );

  it('is written by the service role, read by the club\'s owners and audited', async () => {
    await asService(() => insert({ n: 1 }));
    await asService(() => insert({ n: 2, side: 'bar', method: null, amount: 450_000, action: 'reserve' }));
    await asService(() => insert({ n: 3, clubId: otherClub }));
    const read = await asUser(owner, () => db.query<{ request_id: string }>('select request_id from owner_money_handovers order by request_id'));
    expect(read.rows.map((row) => row.request_id)).toEqual([request(1), request(2)]);
    expect((await asUser(admin, () => db.query('select * from owner_money_handovers'))).rows).toEqual([]);

    await asService(() => db.query('update owner_money_handovers set undone_at = now() where request_id = $1', [request(1)]));
    const audit = await db.query<{ action: string }>(
      "select action from entry_audit_logs where table_name = 'owner_money_handovers' and club_id = $1 order by id", [club],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['insert', 'insert', 'update']);
  });

  it('refuses browser writes', async () => {
    await expect(asUser(owner, () => insert({ n: 10 }))).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(owner, () => db.query('update owner_money_handovers set undone_at = now()'))).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(owner, () => db.query('delete from owner_money_handovers'))).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps each button to the money it can move', async () => {
    // Bar money has no till to collect; a Game Club method cannot be "left in the bar".
    await expect(insert({ n: 20, side: 'bar', method: null, action: 'collected' })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ n: 21, action: 'left' })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ n: 22, side: 'bar', method: 'cash', action: 'reserve' })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ n: 23, method: null })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ n: 24, amount: 0 })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ n: 25, amount: 100.5 })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ n: 1 })).rejects.toMatchObject({ code: '23505' });
    await insert({ n: 26, side: 'bar', method: null, amount: 0, action: 'left' });
  });
});
