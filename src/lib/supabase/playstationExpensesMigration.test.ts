import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 114 on the full replayed schema: PlayStation expenses and the balances they reduce. */

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
    update public.clubs set enabled_payment_methods = array['cash','terminal'] where id = '${club}';
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner');
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',1000,0,500,700,'${owner}');
    grant select on all tables in schema public to authenticated;
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

const addExpense = (n: number, method: string, source = 'game_club', amount = 200) => db.query(
  `insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by)
   values ($1,$2,'2024-08-03',$3,'repair',$4,$5,'fixed the broken console controller','${owner}')`,
  [id(n), club, amount, method, source],
);
const earned = async (method: string) => Number((await db.query<{ v: string }>(
  'select owner_payment_method_earned_for_month($1,$2,$3) as v', [club, method, '2024-08-01'],
)).rows[0].v);
const changeMethod = (expense: string, method: string) => asUser(owner, () => db.query(
  'select update_expense_payment_method($1,$2,$3)', [club, expense, method],
));

describe('PlayStation expenses (114)', () => {
  it('allows them on Game Club money only', async () => {
    await addExpense(1, 'playstation');
    await expect(addExpense(2, 'playstation', 'bar')).rejects.toMatchObject({ code: '23514' });
    await expect(addExpense(2, 'bitcoin')).rejects.toMatchObject({ code: '23514' });
  });

  it('reduces the PlayStation withdrawal limit, not card', async () => {
    expect(await earned('playstation')).toBe(500);
    expect(await earned('card')).toBe(500);
    expect(await earned('cash')).toBe(1000);
  });

  it('moves the snapshot balances from card to PlayStation', async () => {
    const payload = (await asUser(owner, () => db.query<{ snapshot: Record<string, Record<string, unknown>> }>(
      'select public.get_owner_profit_snapshot_with_methods($1,$2) as snapshot', [club, '2024-08-31'],
    ))).rows[0].snapshot;
    expect(payload.paymentMethodBalancesByMonth['2024-08']).toEqual({ cash: 1000, terminal: 0, card: 500, playstation: 500 });
    expect(payload.paymentMethodBalances).toEqual({ cash: 1000, terminal: 0, card: 500, playstation: 500 });
  });

  it('lets an owner correct an expense to PlayStation, but not a Bar expense', async () => {
    await addExpense(3, 'cash', 'game_club', 100);
    await addExpense(4, 'cash', 'bar', 100);
    await changeMethod(id(3), 'playstation');
    expect(await earned('playstation')).toBe(400);
    expect(await earned('cash')).toBe(1000);
    await expect(changeMethod(id(4), 'playstation')).rejects.toMatchObject({ code: '23514' });
  });

  it('still refuses a configurable method the club switched off', async () => {
    await expect(changeMethod(id(3), 'card')).rejects.toThrow('not enabled');
  });
});
