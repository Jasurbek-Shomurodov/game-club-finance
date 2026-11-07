import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 126 on the full replayed schema: an owner corrects an expense's category. */

const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
const owner = '00000000-0000-0000-0000-000000000001';
const manager = '00000000-0000-0000-0000-000000000002';
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
    insert into auth.users values ('${owner}','o@x.test'), ('${manager}','m@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    update public.clubs set enabled_payment_methods = array['cash','terminal'] where id = '${club}';
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner'), ('${club}','${manager}','admin');
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',1000,0,500,700,'${owner}');
    grant select on all tables in schema public to authenticated;
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

const addExpense = (n: number, extra = '', extraValue = '') => db.query(
  `insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by${extra})
   values ($1,$2,'2024-08-03',100,'marketing','cash','game_club','paid the cleaner for this week','${owner}'${extraValue})`,
  [id(n), club],
);
const categoryOf = async (n: number) => (await db.query<{ category: string; preset_id: string | null }>(
  'select category, preset_id from public.expenses where id = $1', [id(n)],
)).rows[0];
const change = (expense: string, category: string, userId = owner) => asUser(userId, () => db.query(
  'select update_expense_category($1,$2,$3)', [club, expense, category],
));

describe('expense category correction (126)', () => {
  it('lets an owner move an expense to another hand-chosen category', async () => {
    await addExpense(1);
    await change(id(1), 'cleaning');
    expect((await categoryOf(1)).category).toBe('cleaning');
  });

  it('refuses salary, unknown categories, non-owners and other clubs\' expenses', async () => {
    await expect(change(id(1), 'salary')).rejects.toMatchObject({ code: '23514' });
    await expect(change(id(1), 'bitcoin')).rejects.toMatchObject({ code: '23514' });
    await expect(change(id(1), 'rent', manager)).rejects.toMatchObject({ code: '42501' });
    await expect(change(id(99), 'rent')).rejects.toMatchObject({ code: 'P0002' });
    expect((await categoryOf(1)).category).toBe('cleaning');
  });

  it('takes an expense out of its preset when its category changes', async () => {
    await db.query(
      `insert into public.expense_presets (id, club_id, name, category, payment_source, monthly_amount)
       values ($1,$2,'Ads','marketing','game_club',100)`,
      [id(50), club],
    );
    await addExpense(2, ', preset_id', `,'${id(50)}'`);
    await change(id(2), 'marketing');
    expect(await categoryOf(2)).toEqual({ category: 'marketing', preset_id: id(50) });
    await change(id(2), 'equipment');
    expect(await categoryOf(2)).toEqual({ category: 'equipment', preset_id: null });
  });
});
