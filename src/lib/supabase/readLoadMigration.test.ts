import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 149 on the full replayed schema: cheaper reads that return what the old ones did. */

const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const otherOwner = '00000000-0000-0000-0000-000000000003';
const applicant = '00000000-0000-0000-0000-000000000004';
const rejected = '00000000-0000-0000-0000-000000000005';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const cola = '30000000-0000-0000-0000-000000000001';
const chips = '30000000-0000-0000-0000-000000000002';
const neverCounted = '30000000-0000-0000-0000-000000000003';
const otherProduct = '30000000-0000-0000-0000-000000000004';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const indexNames = async () => (await db.query<{ indexname: string }>(
  "select indexname from pg_indexes where schemaname = 'public'",
)).rows.map((row) => row.indexname);

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
  // The 057 body under another name, to compare the rewrite with.
  const original = readMigration('057_stock_opening_purchase_carry_forward.sql');
  const start = original.indexOf('create or replace function public.get_stock_opening_balances(');
  await db.exec(original.slice(start, original.indexOf('$$;', start) + 3)
    .replace('public.get_stock_opening_balances(', 'public.opening_balances_057('));

  await db.exec(`
    insert into auth.users (id, email) values
      ('${owner}','o@x.test'),('${admin}','a@x.test'),('${otherOwner}','p@x.test'),
      ('${applicant}','new@x.test'),('${rejected}','no@x.test')
      on conflict do nothing;
    insert into public.profiles (id, email, full_name) values
      ('${owner}','o@x.test','Owner'),('${admin}','a@x.test','Admin'),('${otherOwner}','p@x.test','Other'),
      ('${applicant}','new@x.test','Applicant'),('${rejected}','no@x.test','Rejected')
      on conflict (id) do nothing;
    update public.profiles set access_rejected_at = now() where id = '${rejected}';
    insert into public.clubs (id, name) values ('${club}', 'Club'), ('${otherClub}', 'Other club');
    insert into public.club_memberships (club_id, user_id, role) values
      ('${club}','${owner}','owner'),('${club}','${admin}','admin'),('${otherClub}','${otherOwner}','owner');
    -- Seed ledgers as plain rows: the save RPCs and their chain checks are not under test here.
    set session_replication_role = replica;
    insert into public.products (id, club_id, name, sale_price, cost_price, current_stock) values
      ('${cola}','${club}','Cola',10000,6000,7),('${chips}','${club}','Chips',8000,5000,3),
      ('${neverCounted}','${club}','Gum',2000,1000,0),('${otherProduct}','${otherClub}','Tea',5000,2000,9);
    insert into public.daily_stock_counts (club_id, date, product_id, previous_stock, added_today, closing_stock, sold_quantity, sale_price, cost_price, bar_income, bar_cost, bar_profit) values
      ('${club}','2026-10-01','${cola}',20,0,15,5,10000,6000,50000,30000,20000),
      ('${club}','2026-10-03','${cola}',15,0,12,3,10000,6000,30000,18000,12000),
      ('${club}','2026-10-03','${chips}',10,0,6,4,8000,5000,32000,20000,12000),
      ('${club}','2026-10-06','${cola}',12,0,7,5,10000,6000,50000,30000,20000),
      ('${otherClub}','2026-10-03','${otherProduct}',12,0,9,3,5000,2000,15000,6000,9000);
    insert into public.stock_purchases (club_id, date, product_id, quantity, cost_price) values
      ('${club}','2026-10-02','${cola}',6,6000),
      ('${club}','2026-10-04','${chips}',5,5000),
      ('${club}','2026-10-05','${neverCounted}',4,1000),
      ('${otherClub}','2026-10-05','${otherProduct}',2,2000);
    insert into public.entry_audit_logs (club_id, table_name, row_id, action, old_row, changed_on) values
      ('${club}','expenses',gen_random_uuid(),'delete','{}','2026-10-03'),
      ('${otherClub}','expenses',gen_random_uuid(),'delete','{}','2026-10-03');
    set session_replication_role = origin;
    grant select on all tables in schema public to authenticated;
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('migration 149: read load', () => {
  it('returns the same opening balances as the 057 definition on every date', async () => {
    for (const date of ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-12-31']) {
      for (const clubId of [club, otherClub]) {
        const [next, previous] = await Promise.all(['get_stock_opening_balances', 'opening_balances_057'].map(async (fn) => (
          await db.query(`select product_id, previous_stock::float8 as previous_stock from public.${fn}($1,$2) order by product_id`, [clubId, date])
        ).rows));
        expect(next, `${clubId} before ${date}`).toEqual(previous);
      }
    }
    // The latest closing plus the receipt on a skipped date; no row for another club's product.
    const rows = (await db.query<{ product_id: string; previous_stock: number }>(
      'select product_id, previous_stock::float8 as previous_stock from public.get_stock_opening_balances($1,$2) order by product_id', [club, '2026-10-05'],
    )).rows;
    expect(rows).toEqual([
      { product_id: cola, previous_stock: 12 },
      { product_id: chips, previous_stock: 11 },
    ]);
  });

  it('keeps opening balances behind the caller\'s row security', async () => {
    const rows = await asUser(otherOwner, async () => (await db.query(
      'select * from public.get_stock_opening_balances($1,$2)', [club, '2026-10-07'],
    )).rows);
    expect(rows).toEqual([]);
  });

  it('sums each product\'s bar sales inside the range, for members who can read stock counts', async () => {
    const sales = (userId: string, from: string, to: string) => asUser(userId, async () => (await db.query(
      `select product_id, sold_quantity::float8 as sold, bar_income::float8 as income, bar_cost::float8 as cost, days_counted
       from public.get_bar_product_sales($1,$2,$3) order by product_id`, [club, from, to],
    )).rows);
    expect(await sales(owner, '2026-10-01', '2026-10-31')).toEqual([
      { product_id: cola, sold: 13, income: 130000, cost: 78000, days_counted: 3 },
      { product_id: chips, sold: 4, income: 32000, cost: 20000, days_counted: 1 },
    ]);
    expect(await sales(owner, '2026-10-02', '2026-10-03')).toEqual([
      { product_id: cola, sold: 3, income: 30000, cost: 18000, days_counted: 1 },
      { product_id: chips, sold: 4, income: 32000, cost: 20000, days_counted: 1 },
    ]);
    expect(await sales(otherOwner, '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('counts open access requests the way the two table reads did', async () => {
    const count = (userId: string) => asUser(userId, async () => (await db.query<{ n: number }>(
      'select public.count_pending_access_requests() as n',
    )).rows[0].n);
    const byTables = (userId: string) => asUser(userId, async () => {
      const profiles = (await db.query<{ id: string; access_rejected_at: string | null }>('select id, access_rejected_at from public.profiles')).rows;
      const members = new Set((await db.query<{ user_id: string }>('select user_id from public.club_memberships')).rows.map((row) => row.user_id));
      return profiles.filter((profile) => !members.has(profile.id) && !profile.access_rejected_at).length;
    });
    // The applicant only: the rejected sign-up and every member are left out.
    expect(await count(owner)).toBe(1);
    for (const userId of [owner, admin, otherOwner, applicant]) expect(await count(userId)).toBe(await byTables(userId));
  });

  it('shows the edit history and shortages to the club owner only', async () => {
    const clubs = (userId: string, table: string) => asUser(userId, async () => (
      await db.query<{ club_id: string }>(`select distinct club_id from public.${table} order by club_id`)
    ).rows.map((row) => row.club_id));
    expect(await clubs(owner, 'entry_audit_logs')).toEqual([club]);
    expect(await clubs(otherOwner, 'entry_audit_logs')).toEqual([otherClub]);
    expect(await clubs(admin, 'entry_audit_logs')).toEqual([]);
    expect(await clubs(admin, 'cash_shortages')).toEqual([]);
    const policies = (await db.query<{ policyname: string; qual: string }>(
      "select policyname, qual from pg_policies where policyname in ('entry_audit_logs_owner_read','cash_shortages_owner_read')",
    )).rows;
    expect(policies).toHaveLength(2);
    for (const policy of policies) expect(policy.qual).toContain('current_user_member_clubs');
  });

  it('adds the indexes the reads need and drops the ones nothing uses', async () => {
    const names = await indexNames();
    expect(names).toEqual(expect.arrayContaining(['idx_expenses_club_reserve_or_usd', 'idx_stock_counts_promotion']));
    for (const dropped of ['expenses_paid_from_reserve', 'idx_products_sort_order', 'idx_products_not_deleted', 'owner_reserve_entries_collection']) {
      expect(names).not.toContain(dropped);
    }
    // The unique index that made owner_reserve_entries_collection redundant is still there.
    expect(names).toContain('owner_reserve_entries_collection_method');
  });

  it('keeps the new functions away from anonymous callers and runs twice', async () => {
    const grants = (await db.query<{ routine_name: string; grantee: string }>(
      `select routine_name, grantee from information_schema.routine_privileges
       where routine_name in ('count_pending_access_requests','get_bar_product_sales','get_stock_opening_balances')`,
    )).rows;
    expect(grants.some((grant) => grant.grantee === 'anon' || grant.grantee === 'PUBLIC')).toBe(false);
    expect(grants.filter((grant) => grant.grantee === 'authenticated')).toHaveLength(3);
    await expect(db.exec(readMigration('149_read_load_and_bar_product_sales.sql'))).resolves.toBeDefined();
  });
});
