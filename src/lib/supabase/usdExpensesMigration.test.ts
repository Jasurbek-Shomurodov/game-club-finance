import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 124 on the full replayed schema: expenses paid from the club's US dollars. */

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

const addExpense = (
  n: number,
  { method = 'usd', source = 'game_club', amount = 1260, usd = 0.1 as number | null, rate = 12600 as number | null } = {},
) => db.query(
  `insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by, usd_amount, usd_rate)
   values ($1,$2,'2024-08-03',$3,'repair',$4,$5,'fixed the broken console controller','${owner}',$6,$7)`,
  [id(n), club, amount, method, source, usd, rate],
);
const earned = async (method: string) => Number((await db.query<{ v: string }>(
  'select owner_payment_method_earned_for_month($1,$2,$3) as v', [club, method, '2024-08-01'],
)).rows[0].v);
const changeMethod = (expense: string, method: string) => asUser(owner, () => db.query(
  'select update_expense_payment_method($1,$2,$3)', [club, expense, method],
));

describe('dollar expenses (124)', () => {
  it('stores dollars and rate that match the sums, on Game Club money only', async () => {
    await addExpense(1);
    await expect(addExpense(2, { source: 'bar' })).rejects.toMatchObject({ code: '23514' });
    await expect(addExpense(2, { amount: 999 })).rejects.toMatchObject({ code: '23514' });
    await expect(addExpense(2, { usd: null })).rejects.toMatchObject({ code: '23514' });
    await expect(addExpense(2, { method: 'cash' })).rejects.toMatchObject({ code: '23514' });
    await addExpense(2, { method: 'cash', amount: 100, usd: null, rate: null });
  });

  it('leaves every UZS withdrawal limit alone', async () => {
    expect(await earned('card')).toBe(500);
    expect(await earned('playstation')).toBe(700);
    expect(await earned('cash')).toBe(900);
  });

  it('keeps the snapshot card balance whole', async () => {
    const payload = (await asUser(owner, () => db.query<{ snapshot: Record<string, Record<string, unknown>> }>(
      'select public.get_owner_profit_snapshot_with_methods($1,$2) as snapshot', [club, '2024-08-31'],
    ))).rows[0].snapshot;
    expect(payload.paymentMethodBalancesByMonth['2024-08']).toEqual({ cash: 900, terminal: 0, card: 500, playstation: 700 });
    expect(payload.paymentMethodBalances).toEqual({ cash: 900, terminal: 0, card: 500, playstation: 700 });
  });

  it('never moves an expense into or out of dollars', async () => {
    await expect(changeMethod(id(1), 'cash')).rejects.toMatchObject({ code: '23514' });
    await expect(changeMethod(id(2), 'usd')).rejects.toThrow('Invalid payment method');
  });
});
