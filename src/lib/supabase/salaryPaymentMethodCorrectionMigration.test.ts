import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 127 on the full replayed schema: an owner corrects a salary payment's method. */

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
const employee = id(70);
const payroll = async (n: number, method = 'cash') => {
  await asUser(owner, () => db.query(
    `select * from record_salary_entry_with_status($1,$2,$3,'2024-08-03','payment',100,'',$4,'game_club')`,
    [club, employee, id(n), method],
  ));
  return (await db.query<{ id: string }>('select id from public.expenses where salary_entry_id = $1', [id(n)])).rows[0].id;
};
const methods = async (entry: number) => (await db.query<{ entry: string; expense: string }>(
  `select s.payment_method as entry, e.payment_method as expense
   from public.salary_entries s join public.expenses e on e.salary_entry_id = s.id where s.id = $1`, [id(entry)],
)).rows[0];
const change = (expense: string, method: string, userId = owner) => asUser(userId, () => db.query(
  'select update_salary_payment_method($1,$2,$3)', [club, expense, method],
));

describe('salary payment method correction (127)', () => {
  beforeAll(async () => {
    await db.exec(`insert into public.salary_employees (id, club_id, name, joined_on, created_by)
      values ('${employee}','${club}','Izzat','2024-01-01','${owner}')`);
  });

  it('moves the salary entry and its expense to the new method together', async () => {
    const expense = await payroll(1);
    await change(expense, 'terminal');
    expect(await methods(1)).toEqual({ entry: 'terminal', expense: 'terminal' });
  });

  it('refuses disabled methods, non-owners, ordinary expenses and other clubs', async () => {
    const expense = await payroll(2);
    await expect(change(expense, 'card')).rejects.toThrow(/not enabled/);
    await expect(change(expense, 'playstation')).rejects.toThrow(/Invalid payment method/);
    await expect(change(expense, 'terminal', manager)).rejects.toMatchObject({ code: '42501' });
    await expect(change(id(99), 'terminal')).rejects.toMatchObject({ code: 'P0002' });
    await db.query(
      `insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by)
       values ($1,$2,'2024-08-03',100,'marketing','cash','game_club','paid the cleaner for this week','${owner}')`,
      [id(3), club],
    );
    await expect(change(id(3), 'terminal')).rejects.toMatchObject({ code: 'P0002' });
    expect(await methods(2)).toEqual({ entry: 'cash', expense: 'cash' });
  });

  it('still refuses any other edit of a payroll expense', async () => {
    const expense = await payroll(4);
    await expect(db.query('update public.expenses set payment_method = $2 where id = $1', [expense, 'terminal']))
      .rejects.toThrow(/cannot be edited/);
    await expect(db.query('update public.expenses set amount = 50 where id = $1', [expense]))
      .rejects.toThrow(/cannot be edited/);
  });

  it('keeps a collected day closed', async () => {
    const expense = await payroll(5);
    await db.exec(`insert into public.daily_cash_collections (club_id, date, collected_by) values ('${club}','2024-08-03','${owner}')`);
    await expect(change(expense, 'terminal')).rejects.toMatchObject({ code: '55000' });
    expect(await methods(5)).toEqual({ entry: 'cash', expense: 'cash' });
  });
});
