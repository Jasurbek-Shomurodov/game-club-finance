import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 169 on the full replayed schema: collected money sits between the till and the reserve. */

const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
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

beforeAll(async () => {
  db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth; create schema extensions; create schema cron; create schema net;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
    create table cron.job(jobid bigserial primary key, jobname text, schedule text, command text);
    create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
    create function cron.unschedule(job_id bigint) returns boolean language sql as $$ delete from cron.job where jobid = job_id returning true $$;
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
    grant usage on schema public, auth, extensions, cron, net to authenticated, anon, service_role;
  `);
  for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()) {
    await db.exec(readMigration(name));
  }
  await db.exec(`
    insert into auth.users values ('${owner}','o@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner');
    insert into public.daily_cash_entries (id, club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${income}','${club}','2024-08-01',1000000,0,0,0,'${owner}');
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });


const day = (date: string, cash: number) => signedIn(() => db.query(
  `insert into daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
   values ($1,$2,$3,0,0,0,$4)`,
  [club, date, cash, owner],
));
const expense = (date: string, amount: number, fromCollected = false) => signedIn(() => db.query(
  `insert into expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by, paid_from_collected)
   values ($1,$2,$3,$4,'supplies','cash','game_club',$5,$6,$7)`,
  [newId(), club, date, amount, note, owner, fromCollected],
));
const collect = (date: string, amounts: Record<string, number>, requestId = newId()) => signedIn(() => db.query<{ saved: boolean }>(
  'select collect_money($1, $2, $3, $4::jsonb, $5) as saved', [club, requestId, date, JSON.stringify(amounts), null],
)).then((result) => result.rows[0].saved);
const balances = (date: string) => signedIn(() => db.query<{ b: Record<string, { till: number; collected: number }> }>(
  'select get_collection_balances($1, $2) as b', [club, date],
)).then((result) => result.rows[0].b);
const tillShort = { message: expect.stringMatching(/insufficient payment method balance/i), code: 'P0001' };
const collectedShort = { message: expect.stringMatching(/insufficient collected money/i), code: 'P0001' };

describe('collected money (169)', () => {
  let firstCollection: string;

  it('takes money out of the till as a running balance, not day by day', async () => {
    await day('2024-08-02', 1_000_000);
    await day('2024-08-03', 1_000_000);
    expect(await balances('2024-08-02')).toMatchObject({ cash: { till: 2_000_000, collected: 0 } });
    firstCollection = newId();
    expect(await collect('2024-08-02', { cash: 2_000_000, card: 0 }, firstCollection)).toBe(true);
    // A retry of the same request saves nothing twice.
    expect(await collect('2024-08-02', { cash: 2_000_000 }, firstCollection)).toBe(false);
    expect(await balances('2024-08-03')).toMatchObject({ cash: { till: 1_000_000, collected: 2_000_000 } });
  });

  it('refuses collecting more than the till holds', async () => {
    await expect(collect('2024-08-03', { cash: 1_000_001 })).rejects.toMatchObject(tillShort);
    await expect(collect('2024-08-03', { cash: 0 })).rejects.toMatchObject({ code: '23514' });
  });

  it('pays a bill from collected money, not from the admin', async () => {
    await expect(expense('2024-08-03', 3_000_000)).rejects.toMatchObject(tillShort);
    await expect(expense('2024-08-03', 2_000_001, true)).rejects.toMatchObject(collectedShort);
    await expense('2024-08-03', 1_500_000, true);
    expect(await balances('2024-08-03')).toMatchObject({ cash: { till: 1_000_000, collected: 500_000 } });
    // The month's money left is unchanged by where the money sits.
    const left = await signedIn(() => db.query<{ left: string }>(
      `select expense_method_balance($1, 'cash', '2024-08-03'::date) as left`, [club],
    ));
    expect(Number(left.rows[0].left)).toBe(1_500_000);
  });

  it('moves collected money into the reserve, owner only, capped by what was collected', async () => {
    const move = (amount: number) => signedIn(() => db.query(
      `select move_collected_to_reserve($1, $2, '2024-08-03', 'cash', $3, null)`, [club, newId(), amount],
    ));
    await expect(move(500_001)).rejects.toMatchObject({ code: expect.stringMatching(/P0001|23514/) });
    await move(500_000);
    expect(await balances('2024-08-03')).toMatchObject({ cash: { till: 1_000_000, collected: 0 } });
    const reserve = await db.query<{ from_collected: boolean }>(
      `select from_collected from owner_reserve_entries where club_id = $1 and entry_date = '2024-08-03'`, [club],
    );
    expect(reserve.rows).toEqual([{ from_collected: true }]);
  });

  it('refuses undoing a collection whose money was already spent', async () => {
    await expect(signedIn(() => db.query('select delete_money_collection($1, $2)', [club, firstCollection])))
      .rejects.toMatchObject(collectedShort);
  });

  it('keeps paid-from-collected for Game Club sums only', async () => {
    await expect(signedIn(() => db.query(
      `insert into expenses (club_id, date, amount, category, payment_method, payment_source, comment, created_by, paid_from_collected)
       values ($1,'2024-08-03',10,'supplies','cash','bar',$2,$3,true)`,
      [club, note, owner],
    ))).rejects.toMatchObject({ code: '23514' });
  });
});

describe('169 backfill of ticked days', () => {
  it('records the till up to the last ticked day, capped so later days stay at zero or above', async () => {
    const other = '10000000-0000-0000-0000-000000000002';
    await db.exec(`
      insert into public.clubs (id, name) values ('${other}', 'Ticked');
      insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
        values ('${other}','2024-09-01',1000000,0,0,0,'${owner}'), ('${other}','2024-09-02',1000000,0,0,0,'${owner}'),
               ('${other}','2024-09-03',100000,0,0,0,'${owner}');
      insert into public.expenses (club_id, date, amount, category, payment_method, payment_source, comment, created_by)
        values ('${other}','2024-09-03',500000,'supplies','cash','game_club','${note}','${owner}');
      insert into public.daily_cash_collections (club_id, date, collected_by) values ('${other}','2024-09-02','${owner}');
    `);
    // Re-running 169 backfills the new club: 2 000 000 held on the 2nd, but the 3rd spends 400 000 more than it earns.
    await db.exec(readMigration('169_money_collections.sql'));
    const rows = await db.query<{ date: string; amount: string }>(
      `select date::text, amount::text from money_collections where club_id = $1`, [other],
    );
    expect(rows.rows).toEqual([{ date: '2024-09-02', amount: '1600000' }]);
  });
});
