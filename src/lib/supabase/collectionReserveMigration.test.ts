import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migrations 137 and 139 on the full replayed schema: collected money goes into the reserve. */

const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
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
    insert into auth.users values ('${owner}','o@x.test'), ('${admin}','a@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    update public.clubs set enabled_payment_methods = array['cash','terminal'] where id = '${club}';
    insert into public.club_memberships (club_id, user_id, role, feature_access) values ('${club}','${owner}','owner',null), ('${club}','${admin}','admin',array['reports','collection']);
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',1000,200,0,0,'${owner}'), ('${club}','2024-08-03',300,0,0,0,'${owner}');
    insert into public.expenses (club_id, date, amount, category, payment_method, payment_source, comment, created_by)
      values ('${club}','2024-08-02',150,'food_drinks','cash','game_club','Water and bread for the bar','${owner}'),
             ('${club}','2024-08-02',250,'internet','terminal','game_club','Paid the internet bill by terminal','${owner}');
    -- Supabase's default table privileges; RLS and triggers still decide.
    grant select, insert on public.expenses to authenticated;
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

const aug = '2024-08-01';
const call = <T = unknown>(sql: string, params: unknown[], userId = owner) => asUser(userId, () => db.query<T>(sql, params));
const num = async (sql: string, params: unknown[]) => Number(Object.values((await db.query<Record<string, string>>(sql, params)).rows[0])[0]);
const reserve = (method: string | null = 'cash') => num('select public.owner_reserve_balance($1,$2,$3)', [club, 'game_club', method]);
const available = (method: string | null = 'cash') => num('select public.owner_profit_bucket_available($1,$2,$3,$4)', [club, 'game_club', method, aug]);
const mark = (date: string, userId = owner) => call('select mark_daily_cash_collected($1,$2) as ticked', [club, date], userId);
const unmark = (date: string) => call('select unmark_daily_cash_collected($1,$2)', [club, date]);
const collectionDeposits = async (date: string) => (await db.query<{ payment_method: string; amount: string }>(
  'select payment_method, amount from public.owner_reserve_entries where club_id = $1 and collection_date = $2 order by payment_method', [club, date],
)).rows.map((row) => [row.payment_method, Number(row.amount)]);

describe('collected money goes into the reserve (137)', () => {
  it('deposits each method of the day, skipping a method that is short, once per tick', async () => {
    expect((await mark('2024-08-02', admin)).rows[0]).toEqual({ ticked: true });
    // Cash 1000 - 150; terminal 200 - 250 is short and deposits nothing.
    expect(await collectionDeposits('2024-08-02')).toEqual([['cash', 850]]);
    expect(await reserve()).toBe(850);
    // Game Club has 1100 in the month (terminal is 50 short), so 250 is left.
    expect(await available()).toBe(250);
    expect((await mark('2024-08-02')).rows[0]).toEqual({ ticked: false });
    expect(await reserve()).toBe(850);
  });

  it('caps a deposit at what the month still has for the method', async () => {
    await call('select withdraw_owner_game_club_money_by_method($1,$2,$3,$4,$5)', [club, aug, 'cash', 100, 'Taking some cash home today']);
    expect(await available()).toBe(150);
    await mark('2024-08-03');
    expect(await collectionDeposits('2024-08-03')).toEqual([['cash', 150]]);
    expect(await available()).toBe(0);
  });

  it('keeps a collection deposit from being deleted on its own', async () => {
    const entry = (await db.query<{ id: string }>('select id from public.owner_reserve_entries where collection_date = $1', ['2024-08-03'])).rows[0];
    await expect(call('select delete_owner_reserve_entry($1,$2)', [club, entry.id])).rejects.toMatchObject({ hint: 'reserve_collection_entry' });
  });

  it('takes the deposits back out when the tick is undone, unless the reserve spent them', async () => {
    await call(
      `insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by, paid_from_reserve)
       values ($1,$2,'2024-08-05',1000,'equipment','cash','game_club','Two new gaming PCs for hall',$3,true)`, [id(1), club, owner],
    );
    await expect(unmark('2024-08-03')).rejects.toMatchObject({ hint: 'reserve_already_used' });
    expect(await collectionDeposits('2024-08-03')).toEqual([['cash', 150]]);
    await db.query('delete from public.expenses where id = $1', [id(1)]);
    await unmark('2024-08-03');
    expect(await collectionDeposits('2024-08-03')).toEqual([]);
    expect((await db.query('select 1 from public.daily_cash_collections where date = $1', ['2024-08-03'])).rows).toEqual([]);
    expect(await reserve()).toBe(850);
    expect(await available()).toBe(150);
  });

  it('back-fills a day collected before 137, capped and credited to who ticked it, once (139)', async () => {
    // A tick from before 137: the collection row with no deposit.
    await db.query('insert into public.daily_cash_collections (club_id, date, collected_by) values ($1,$2,$3)', [club, '2024-08-03', admin]);
    await db.exec(readMigration('139_backfill_collection_reserve.sql'));
    // The day has 300 cash, but the month has only 150 left after the withdrawal.
    expect(await collectionDeposits('2024-08-03')).toEqual([['cash', 150]]);
    expect(await num('select created_by::text = $1 from public.owner_reserve_entries where collection_date = $2', [admin, '2024-08-03'])).toBe(1);
    await db.exec(readMigration('139_backfill_collection_reserve.sql'));
    expect(await collectionDeposits('2024-08-03')).toEqual([['cash', 150]]);
    expect(await available()).toBe(0);
  });
});
