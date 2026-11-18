import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 150 on the full replayed schema: one call returns what the seven owner money reads did. */

const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
const owner = '00000000-0000-0000-0000-000000000001';
const stranger = '00000000-0000-0000-0000-000000000002';
const otherOwner = '00000000-0000-0000-0000-000000000003';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const id = (n: number) => `40000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

type Bundle = Record<'carryovers' | 'investments' | 'exchanges' | 'dollarExpenses' | 'reserveEntries' | 'reserveExpenses', Array<Record<string, unknown>>>
  & { snapshot: Record<string, unknown> };

const bundle = async (userId: string, clubId: string, through: string) => asUser(userId, async () => (
  await db.query<{ bundle: Bundle }>('select public.get_owner_money_bundle($1,$2) as bundle', [clubId, through])
).rows[0].bundle);

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
    insert into auth.users (id, email) values ('${owner}','o@x.test'),('${stranger}','s@x.test'),('${otherOwner}','p@x.test') on conflict do nothing;
    insert into public.profiles (id, email, full_name) values
      ('${owner}','o@x.test','Owner'),('${stranger}','s@x.test','Stranger'),('${otherOwner}','p@x.test','Other') on conflict (id) do nothing;
    insert into public.clubs (id, name) values ('${club}', 'Club'), ('${otherClub}', 'Other club');
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner'),('${otherClub}','${otherOwner}','owner');
    -- Seed ledgers as plain rows: the save RPCs and their balance checks are not under test here.
    set session_replication_role = replica;
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, created_by) values
      ('${club}','2026-09-10',900000,0,400000,'${owner}'),('${club}','2026-10-05',500000,0,0,'${owner}');
    insert into public.owner_profit_carryovers (id, club_id, from_month, source, payment_method, amount, comment, created_by) values
      ('${id(1)}','${club}','2026-09-01','game_club','cash',100000,'moved on','${owner}'),
      ('${id(2)}','${club}','2026-11-01','game_club','cash',5000,'after the through date','${owner}'),
      ('${id(3)}','${otherClub}','2026-09-01','game_club','cash',7000,'other club','${otherOwner}');
    insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by, usd_amount, usd_rate, paid_from_reserve) values
      ('${id(10)}','${club}','2026-09-12',200000,'investments','cash','game_club','new consoles for the hall','${owner}',null,null,false),
      ('${id(11)}','${club}','2026-10-02',632500,'rent','usd','game_club','paid the hall rent in dollars','${owner}',50,12650,false),
      ('${id(12)}','${club}','2026-10-03',80000,'repair','cash','game_club','reserve paid for the repair','${owner}',null,null,true),
      ('${id(13)}','${club}','2026-11-20',90000,'investments','cash','game_club','after the through date','${owner}',null,null,false),
      ('${id(14)}','${otherClub}','2026-10-02',50000,'investments','cash','game_club','other club investment','${otherOwner}',null,null,true);
    insert into public.money_exchanges (id, club_id, date, from_method, to_method, from_amount, to_amount, rate, comment, created_by) values
      ('${id(20)}','${club}','2026-10-01','card','usd',1265000,100,12650,'bought dollars for the reserve','${owner}'),
      ('${id(21)}','${club}','2026-09-15','cash','card',300000,300000,null,'paid cash into the card','${owner}'),
      ('${id(22)}','${club}','2026-11-15','cash','card',1000,1000,null,'after the through date','${owner}'),
      ('${id(23)}','${otherClub}','2026-10-01','cash','card',2000,2000,null,'other club exchange','${otherOwner}');
    insert into public.owner_reserve_entries (id, club_id, kind, period_month, source, payment_method, amount, comment, entry_date, created_by) values
      ('${id(30)}','${club}','deposit','2026-09-01','game_club','cash',150000,'set aside','2026-09-30','${owner}'),
      ('${id(31)}','${otherClub}','deposit','2026-09-01','bar',null,9000,'other club','2026-09-30','${otherOwner}');
    set session_replication_role = origin;
    -- Supabase's default privileges; row level security still decides the rows.
    grant select on all tables in schema public to authenticated;
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

const ids = (rows: Array<Record<string, unknown>>) => rows.map((row) => row.id);

describe('migration 150: owner money bundle', () => {
  it('returns each list for the club only, through the date, in the order the app reads them', async () => {
    const result = await bundle(owner, club, '2026-10-25');
    expect(ids(result.carryovers)).toEqual([id(1)]);
    expect(result.investments).toEqual([{ date: '2026-09-12', amount: 200000, payment_source: 'game_club' }]);
    // By date, then id.
    expect(ids(result.exchanges)).toEqual([id(21), id(20)]);
    expect(result.dollarExpenses).toEqual([
      { id: id(11), date: '2026-10-02', amount: 632500, payment_method: 'usd', usd_amount: 50, usd_rate: 12650 },
    ]);
    expect(ids(result.reserveEntries)).toEqual([id(30)]);
    // Reserve purchases and dollar expenses, whatever their date.
    expect(ids(result.reserveExpenses)).toEqual([id(11), id(12)]);
  });

  it('carries the columns the separate reads select', async () => {
    const result = await bundle(owner, club, '2026-10-25');
    expect(Object.keys(result.carryovers[0]).sort()).toEqual(
      ['amount', 'club_id', 'comment', 'created_at', 'created_by', 'from_month', 'id', 'payment_method', 'source', 'to_month'],
    );
    expect(result.carryovers[0]).toMatchObject({ from_month: '2026-09-01', to_month: '2026-10-01', amount: 100000 });
    expect(Object.keys(result.exchanges[0]).sort()).toEqual(
      ['comment', 'created_at', 'created_by', 'date', 'from_amount', 'from_method', 'id', 'rate', 'to_amount', 'to_method'],
    );
    expect(Object.keys(result.reserveEntries[0]).sort()).toEqual(
      ['amount', 'club_id', 'collection_date', 'comment', 'created_at', 'created_by', 'entry_date', 'id', 'kind', 'payment_method', 'period_month', 'source'],
    );
    expect(Object.keys(result.reserveExpenses[0]).sort()).toEqual(
      ['amount', 'category', 'comment', 'created_at', 'date', 'id', 'payment_method', 'payment_source'],
    );
  });

  it('embeds the same snapshot the snapshot function returns on its own', async () => {
    const result = await bundle(owner, club, '2026-10-25');
    const alone = await asUser(owner, async () => (
      await db.query<{ snapshot: unknown }>('select public.get_owner_profit_snapshot_with_methods($1,$2) as snapshot', [club, '2026-10-25'])
    ).rows[0].snapshot);
    expect(result.snapshot).toEqual(alone);
    expect(result.snapshot).toHaveProperty('paymentMethodBalancesByMonth');
  });

  it('refuses someone who is not a member of the club', async () => {
    await expect(bundle(stranger, club, '2026-10-25')).rejects.toThrow();
    await expect(bundle(otherOwner, club, '2026-10-25')).rejects.toThrow();
  });

  it('is not callable anonymously', async () => {
    const grants = (await db.query<{ grantee: string }>(
      "select grantee from information_schema.routine_privileges where routine_name = 'get_owner_money_bundle' and privilege_type = 'EXECUTE'",
    )).rows.map((row) => row.grantee);
    expect(grants).toContain('authenticated');
    expect(grants).not.toContain('anon');
    expect(grants).not.toContain('PUBLIC');
  });
});
