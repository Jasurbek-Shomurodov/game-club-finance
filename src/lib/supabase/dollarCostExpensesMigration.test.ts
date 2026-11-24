import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 184 on the full replayed schema: a USD-account expense is counted at what its dollars cost. */

const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
const owner = '00000000-0000-0000-0000-000000000001';
const club = '10000000-0000-0000-0000-000000000001';
const emptyClub = '10000000-0000-0000-0000-000000000002';
const soldClub = '10000000-0000-0000-0000-000000000003';
const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);"); }
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
    insert into public.clubs (id, name) values ('${club}', 'Club'), ('${emptyClub}', 'No dollars'), ('${soldClub}', 'Sold dollars');
    insert into public.club_memberships (club_id, user_id, role)
      values ('${club}','${owner}','owner'), ('${emptyClub}','${owner}','owner'), ('${soldClub}','${owner}','owner');
    grant select on all tables in schema public to authenticated;
    grant insert on public.expenses to authenticated;
    -- $100 for 1 200 000 and $100 for 1 300 000: 12 500 a dollar on average.
    insert into public.money_exchanges (id, club_id, date, from_method, to_method, from_amount, to_amount, rate, comment, created_by) values
      ('${id(900)}','${club}','2024-08-01','cash','usd',1200000,100,12000,'bought dollars for the rent','${owner}'),
      ('${id(901)}','${club}','2024-08-02','card','usd',1300000,100,13000,'bought dollars for the rent','${owner}'),
      -- $100 for 1 200 000, then $95 of them sold for 1 300 000: $5 left that cost nothing.
      ('${id(902)}','${soldClub}','2024-08-01','cash','usd',1200000,100,12000,'bought dollars for the rent','${owner}'),
      ('${id(903)}','${soldClub}','2024-08-02','usd','cash',95,1300000,13684.21,'sold dollars at a better rate','${owner}');
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

type Dollars = { clubId?: string; usd: number; amount?: number | null; rate?: number | null };
const insertSql = `insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by, usd_amount, usd_rate)
  values ($1,$2,'2024-08-05',$3,'rent','usd','game_club','paid the monthly hall rent in dollars','${owner}',$4,$5)`;
const params = (n: number, { clubId = club, usd, amount = null, rate = null }: Dollars) => [id(n), clubId, amount, usd, rate];
const spendAsOwner = (n: number, dollars: Dollars) => asUser(owner, () => db.query(insertSql, params(n, dollars)));
const expense = async (n: number) => {
  const row = (await db.query<{ amount: string; usd_rate: string }>(
    'select amount, usd_rate from public.expenses where id = $1', [id(n)],
  )).rows[0];
  return { amount: Number(row.amount), usdRate: Number(row.usd_rate) };
};
const num = async (sql: string, args: unknown[]) => {
  const value = Object.values((await db.query<Record<string, string | null>>(sql, args)).rows[0])[0];
  return value === null ? null : Number(value);
};
const costRate = (clubId = club) => num('select public.dollar_cost_rate($1) as v', [clubId]);
const dollarsValue = () => num('select public.owner_reserve_balance($1,$2,$3) as v', [club, 'game_club', 'usd']);
const dollarsHeld = () => num('select public.expense_method_balance($1,$2,$3) as v', [club, 'usd', '2024-08-20']);
const balances = (clubId = club) => asUser(owner, async () => (await db.query<{ b: Record<string, number | null> }>(
  'select public.get_expense_method_balances($1,$2) as b', [clubId, '2024-08-20'],
)).rows[0].b);

describe('dollar expenses at cost (184)', () => {
  it('prices the expense before every other BEFORE INSERT trigger on expenses sees it', async () => {
    const triggers = (await db.query<{ tgname: string }>(`
      select tgname from pg_trigger
      where tgrelid = 'public.expenses'::regclass and not tgisinternal
        and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 4) = 4
      order by tgname`)).rows.map((row) => row.tgname);
    expect(triggers[0]).toBe('expenses_at_dollar_cost');
    expect(triggers).toEqual(expect.arrayContaining(['expenses_method_balance', 'expenses_reserve_guard', 'expenses_collected_guard']));
  });

  it('tells the expense form what a dollar cost, keeping every key it had', async () => {
    expect(await costRate()).toBe(12_500);
    expect(await balances()).toEqual({ cash: -1_200_000, terminal: 0, card: -1_300_000, playstation: 0, usd: 200, usdRate: 13_000, usdCostRate: 12_500 });
  });

  it('counts a signed-in USD-account expense at what its dollars cost, ignoring the rate the client sent', async () => {
    await spendAsOwner(1, { usd: 50, amount: 600_000, rate: 12_000 });
    expect(await expense(1)).toEqual({ amount: 625_000, usdRate: 12_500 });
  });

  it('leaves the average price of the dollars left unchanged', async () => {
    expect(await dollarsHeld()).toBe(150);
    expect(await dollarsValue()).toBe(1_875_000);
    expect(await costRate()).toBe(12_500);
  });

  it('prices a row sent with dollars only, as the expenses route sends it', async () => {
    await spendAsOwner(2, { usd: 0.5 });
    expect(await expense(2)).toEqual({ amount: 6_250, usdRate: 12_500 });
  });

  it('keeps the values a migration or service-role write passes', async () => {
    await db.query(insertSql, params(3, { usd: 10, amount: 130_000, rate: 13_000 }));
    expect(await expense(3)).toEqual({ amount: 130_000, usdRate: 13_000 });
  });

  it('refuses a USD-account expense when no dollars are held, as before', async () => {
    expect(await costRate(emptyClub)).toBeNull();
    expect((await balances(emptyClub)).usdCostRate).toBeNull();
    await expect(spendAsOwner(4, { clubId: emptyClub, usd: 1 })).rejects.toMatchObject({ hint: 'INSUFFICIENT_BALANCE' });
    await expect(spendAsOwner(4, { clubId: emptyClub, usd: 1, amount: 12_000, rate: 12_000 })).rejects.toMatchObject({ hint: 'INSUFFICIENT_BALANCE' });
    // More dollars than held is refused too, priced or not.
    await expect(spendAsOwner(4, { usd: 1_000 })).rejects.toMatchObject({ hint: 'INSUFFICIENT_BALANCE' });
  });

  it('refuses a USD-account expense whose dollars have no known cost', async () => {
    expect(await costRate(soldClub)).toBeNull();
    await expect(spendAsOwner(5, { clubId: soldClub, usd: 1 })).rejects.toMatchObject({ code: '23514', hint: 'dollar_cost_unknown' });
  });

  it('runs again without changing anything', async () => {
    await db.exec(readMigration('184_dollar_expenses_at_cost.sql'));
    expect(await costRate()).toBe(Number(((1_875_000 - 6_250 - 130_000) / 139.5).toFixed(2)));
    const triggers = await num(
      "select count(*) as v from pg_trigger where tgrelid = 'public.expenses'::regclass and tgname = 'expenses_at_dollar_cost'", [],
    );
    expect(triggers).toBe(1);
  });
});
