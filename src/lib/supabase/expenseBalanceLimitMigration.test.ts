import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 125 on the full replayed schema: a Game Club expense cannot spend more than its method holds. */

const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
const owner = '00000000-0000-0000-0000-000000000001';
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
    insert into auth.users values ('${owner}','o@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner');
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',1000,0,500,700,'${owner}');
    grant select on all tables in schema public to authenticated;
  `);
}, 120_000);


afterAll(async () => { await db?.close(); });

type Expense = { method?: string; source?: string; amount?: number; usd?: number | null; rate?: number | null; date?: string };
const insertSql = `insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by, usd_amount, usd_rate)
  values ($1,$2,$3,$4,'repair',$5,$6,'fixed the broken console controller','${owner}',$7,$8)`;
const params = (n: number, { method = 'cash', source = 'game_club', amount = 100, usd = null, rate = null, date = '2024-08-03' }: Expense) => (
  [id(n), club, date, amount, method, source, usd, rate]
);
const addAsOwner = (n: number, expense: Expense = {}) => asUser(owner, () => db.query(insertSql, params(n, expense)));
const balances = () => asUser(owner, async () => (await db.query<{ b: Record<string, number | null> }>(
  'select public.get_expense_method_balances($1,$2) as b', [club, '2024-08-20'],
)).rows[0].b);

describe('expense balance limit (125)', () => {
  beforeAll(async () => {
    await db.exec(`
      grant insert, update on public.expenses to authenticated;
      insert into public.money_exchanges (id, club_id, date, from_method, to_method, from_amount, to_amount, rate, comment, created_by)
        values ('${id(900)}','${club}','2024-08-02','card','usd',300,3,100,'bought dollars for spare parts','${owner}');
    `);
  });

  it('reports what each method holds and the latest dollar rate', async () => {
    expect(await balances()).toEqual({ cash: 1000, terminal: 0, card: 200, playstation: 700, usd: 3, usdRate: 100 });
  });

  it('refuses an expense larger than its method holds for the month', async () => {
    await addAsOwner(1, { amount: 600 });
    await expect(addAsOwner(2, { amount: 500 })).rejects.toMatchObject({ code: 'P0001', hint: 'INSUFFICIENT_BALANCE' });
    await addAsOwner(2, { amount: 400 });
    await expect(addAsOwner(3, { method: 'card', amount: 201 })).rejects.toMatchObject({ hint: 'INSUFFICIENT_BALANCE' });
    // Another month has its own money: nothing was collected in September.
    await expect(addAsOwner(3, { amount: 1, date: '2024-09-01' })).rejects.toMatchObject({ hint: 'INSUFFICIENT_BALANCE' });
  });

  it('limits dollar expenses by the dollars held', async () => {
    await expect(addAsOwner(4, { method: 'usd', amount: 400, usd: 4, rate: 100 })).rejects.toMatchObject({ hint: 'INSUFFICIENT_BALANCE' });
    await addAsOwner(4, { method: 'usd', amount: 300, usd: 3, rate: 100 });
    expect((await balances()).usd).toBe(0);
  });

  it('leaves Bar expenses and system writes alone', async () => {
    await addAsOwner(5, { source: 'bar', amount: 50_000 });
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
    await db.query(insertSql, params(6, { amount: 50_000 }));
  });

  it('lets a correction lower an expense but not move it where money is missing', async () => {
    await asUser(owner, () => db.query('update public.expenses set amount = 300 where id = $1', [id(2)]));
    await expect(asUser(owner, () => db.query('update public.expenses set payment_method = $2 where id = $1', [id(1), 'terminal'])))
      .rejects.toMatchObject({ hint: 'INSUFFICIENT_BALANCE' });
  });
});
