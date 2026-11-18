import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 162 on the full replayed schema: a reserve deposit or return dated to the day the money moved. */

const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
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
const deposit = (n: number, amount: number, date: string | null, month = aug) => call(
  'select move_owner_profit_to_reserve($1,$2,$3,$4,$5,$6,$7,$8) as created', [club, id(n), month, 'game_club', 'cash', amount, 'PS5', date],
);
const entryDate = async (n: number) => (await db.query<{ entry_date: string }>(
  "select to_char(entry_date, 'YYYY-MM-DD') as entry_date from public.owner_reserve_entries where id = $1", [id(n)],
)).rows[0]?.entry_date;
const moves = () => call<{ moves: Array<{ date: string; amount: number }> }>(
  'select get_reserve_moves($1,$2,$3) as moves', [club, '2024-08-01', '2024-08-31'],
);

describe('reserve entry date (162)', () => {
  it('keeps the chosen day, and moves the money on it', async () => {
    expect((await deposit(1, 300, '2024-08-05')).rows[0]).toEqual({ created: true });
    expect(await entryDate(1)).toBe('2024-08-05');
    expect((await moves()).rows[0].moves).toEqual([{ date: '2024-08-05', source: 'game_club', method: 'cash', amount: 300 }]);
    // A retry with the same id and day is the same deposit; another day is a different one.
    expect((await deposit(1, 300, '2024-08-05')).rows[0]).toEqual({ created: false });
    await expect(deposit(1, 300, '2024-08-06')).rejects.toThrow(/already been used/);
  });

  it('dates a deposit without a day as before: the day it is made, kept inside its month', async () => {
    await deposit(2, 100, null);
    expect(await entryDate(2)).toBe('2024-08-31');
  });

  it('refuses a day outside the month or after today', async () => {
    await expect(deposit(3, 100, '2024-09-01')).rejects.toThrow(/chosen month/);
    const today = (await db.query<{ today: string }>("select to_char(public.club_business_date($1), 'YYYY-MM-DD') as today", [club])).rows[0].today;
    const month = `${today.slice(0, 7)}-01`;
    const tomorrow = (await db.query<{ day: string }>("select to_char($1::date + 1, 'YYYY-MM-DD') as day", [today])).rows[0].day;
    if (tomorrow.slice(0, 7) === today.slice(0, 7)) await expect(deposit(4, 1, tomorrow, month)).rejects.toThrow(/not in the future/);
  });

  it('takes the money out of the till on that day, so it cannot come before the money was there', async () => {
    // Cash came in on 2 August; nothing was there on the 1st.
    await expect(deposit(5, 400, '2024-08-01')).rejects.toThrow(/Insufficient payment method balance/);
    expect(await entryDate(5)).toBeUndefined();
  });
});
