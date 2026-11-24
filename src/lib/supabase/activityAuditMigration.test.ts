import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTIVITY_ONLY_TABLES } from './entryHistory';

/** Migration 183 on the full replayed schema: creations and settings changes kept, and marked for a notice. */

const MIGRATION = '183_activity_audit.sql';
const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
/** A club with no members: the last-owner guard (031) keeps any club with an owner from being deleted. */
const emptyClub = '10000000-0000-0000-0000-000000000003';
const employee = '30000000-0000-0000-0000-000000000001';
const note = 'Cash was missing at the evening handover';
let db: PGlite;
let nextId = 1;
const newId = () => `20000000-0000-0000-0000-${String(nextId++).padStart(12, '0')}`;
let entryAuditBefore = '';

/** Writes as a signed-in user: the triggers read auth.uid() from the request claim. */
async function signedIn<T>(work: () => Promise<T>, user = owner): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub','${user}',false)`);
  try { return await work(); } finally { await db.exec(`select set_config('request.jwt.claim.sub','',false)`); }
}

async function asRole<T>(role: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

interface LogRow {
  id: number;
  club_id: string;
  table_name: string;
  row_id: string | null;
  action: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_by: string | null;
  notice_pending: boolean;
}
const logs = async (table?: string) => (await db.query<LogRow>(
  `select * from public.entry_audit_logs ${table ? 'where table_name = $1' : ''} order by id`,
  table ? [table] : [],
)).rows;
const lastLog = async (table: string) => (await logs(table)).at(-1);

const functionDef = async (name: string) => (await db.query<{ def: string }>(
  `select pg_get_functiondef($1::regprocedure) as def`, [name],
)).rows[0].def;

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
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  for (const name of files.filter((file) => file !== MIGRATION)) {
    await db.exec(readMigration(name));
  }
  entryAuditBefore = await functionDef('public.record_entry_audit()');
  // Setup rows written before 183 leave no activity rows.
  await db.exec(`
    insert into auth.users values ('${owner}','o@x.test'), ('${admin}','a@x.test'), ('${viewer}','v@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club'), ('${otherClub}', 'Other'), ('${emptyClub}', 'Empty');
    insert into public.club_memberships (club_id, user_id, role) values
      ('${club}','${owner}','owner'), ('${club}','${admin}','admin'), ('${otherClub}','${owner}','owner');
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',1000000,0,0,0,'${owner}');
    insert into public.salary_employees (id, club_id, name, joined_on, created_by)
      values ('${employee}','${club}','Izzat','2024-01-01','${owner}');
  `);
  await db.exec(readMigration(MIGRATION));
  await db.exec(readMigration(MIGRATION));
}, 180_000);

afterAll(async () => { await db?.close(); });

describe('activity audit (183)', () => {
  let productId = '';
  let claimedFirst: number[] = [];

  it('leaves record_entry_audit (111) exactly as it was', async () => {
    expect(await functionDef('public.record_entry_audit()')).toBe(entryAuditBefore);
    expect(readMigration(MIGRATION)).not.toMatch(/function public\.record_entry_audit/);
  });

  it('keeps a new product whole, with no old row, marked for a notice', async () => {
    productId = newId();
    await signedIn(() => db.query(
      `insert into public.products (id, club_id, name, sale_price, cost_price, current_stock, is_active)
       values ($1, $2, 'Cola', 12000, 8000, 0, true)`,
      [productId, club],
    ));
    expect(await lastLog('products')).toMatchObject({
      club_id: club, row_id: productId, action: 'insert', old_row: null, changed_by: owner, notice_pending: true,
      new_row: expect.objectContaining({ name: 'Cola', sale_price: 12000 }),
    });
  });

  it('logs an edit only when a watched column changes', async () => {
    const before = (await logs('products')).length;
    await signedIn(() => db.query('update public.products set sort_order = 7, updated_at = now() where id = $1', [productId]));
    expect((await logs('products')).length).toBe(before);
    await signedIn(() => db.query('update public.products set sale_price = 13000 where id = $1', [productId]), admin);
    expect(await lastLog('products')).toMatchObject({
      action: 'update', changed_by: admin, notice_pending: true,
      old_row: expect.objectContaining({ sale_price: 12000 }), new_row: expect.objectContaining({ sale_price: 13000 }),
    });
  });

  it('records a purchase once: the cost it moves onto the product is not logged again', async () => {
    const before = (await logs('products')).length;
    const purchase = newId();
    await signedIn(() => db.query(
      `select public.record_stock_purchase($1, $2, public.club_business_date($2), $3, 10, 9000, null, 'cash', null)`,
      [purchase, club, productId],
    ));
    const product = await db.query<{ cost_price: number }>('select cost_price from public.products where id = $1', [productId]);
    expect(Number(product.rows[0].cost_price)).toBe(9000);
    expect((await logs('products')).length).toBe(before);
    expect(await lastLog('stock_purchases')).toMatchObject({ action: 'insert', row_id: purchase, notice_pending: true });
  });

  it('keys team access by the member, and logs grant, change and removal', async () => {
    await signedIn(() => db.query(`insert into public.club_memberships (club_id, user_id, role) values ($1, $2, 'viewer')`, [club, viewer]));
    await signedIn(() => db.query(`update public.club_memberships set feature_access = array['reports'] where club_id = $1 and user_id = $2`, [club, viewer]));
    await signedIn(() => db.query('delete from public.club_memberships where club_id = $1 and user_id = $2', [club, viewer]));
    const rows = (await logs('club_memberships')).map(({ row_id, action, notice_pending }) => ({ row_id, action, notice_pending }));
    expect(rows).toEqual([
      { row_id: viewer, action: 'insert', notice_pending: true },
      { row_id: viewer, action: 'update', notice_pending: true },
      { row_id: viewer, action: 'delete', notice_pending: true },
    ]);
  });

  it('logs club settings under the club itself', async () => {
    await signedIn(() => db.query(`update public.clubs set logo_url = 'https://x.test/logo.png' where id = $1`, [club]));
    expect(await logs('clubs')).toEqual([]);
    await signedIn(() => db.query('update public.clubs set business_day_start_hour = 6 where id = $1', [club]));
    expect(await lastLog('clubs')).toMatchObject({ club_id: club, row_id: club, action: 'update', notice_pending: true });
  });

  it('keeps a shortage recovered from salary, and collected money moved into the reserve', async () => {
    await signedIn(() => db.query(`update public.clubs set enabled_payment_methods = array['cash','terminal'] where id = $1`, [club]));
    const shortage = newId();
    const fine = newId();
    await signedIn(() => db.query(
      'select record_cash_shortage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [club, shortage, '2024-08-03', 'game_club', 'cash', 5000, 'stolen', employee, note, 0, null],
    ));
    await signedIn(() => db.query('select recover_cash_shortage($1, $2, $3, $4)', [club, shortage, fine, 2000]));
    expect(await lastLog('salary_entries')).toMatchObject({
      action: 'insert', row_id: fine, notice_pending: true, new_row: expect.objectContaining({ cash_shortage_id: shortage }),
    });

    await signedIn(() => db.query(`select collect_money($1, $2, '2024-08-02', '{"cash": 300000}'::jsonb, null)`, [club, newId()]));
    const reserve = newId();
    await signedIn(() => db.query(`select move_collected_to_reserve($1, $2, '2024-08-02', 'cash', 100000, null)`, [club, reserve]));
    expect(await lastLog('owner_reserve_entries')).toMatchObject({ action: 'insert', row_id: reserve, notice_pending: true });
  });

  it('marks a removed collection, but not an edit of a ledger that announces its own', async () => {
    const request = newId();
    await signedIn(() => db.query(`select collect_money($1, $2, '2024-08-02', '{"cash": 50000}'::jsonb, null)`, [club, request]));
    await signedIn(() => db.query('select delete_money_collection($1, $2)', [club, request]));
    expect(await lastLog('money_collections')).toMatchObject({ action: 'delete', notice_pending: true });

    await signedIn(() => db.query(`update public.daily_cash_entries set cash_income = 1100000 where club_id = $1 and date = '2024-08-02'`, [club]));
    expect(await lastLog('daily_cash_entries')).toMatchObject({ action: 'update', notice_pending: false });

    // Kept, but /api/salaries announces an employee's details itself.
    await signedIn(() => db.query(`update public.salary_employees set job_title = 'Admin' where id = $1`, [employee]));
    expect(await lastLog('salary_employees')).toMatchObject({ action: 'update', notice_pending: false });
  });

  it('runs every trigger with its club column, row id and watched columns', async () => {
    const { rows } = await db.query<{ table: string; name: string; def: string }>(`
      select c.relname as table, t.tgname as name, pg_get_triggerdef(t.oid) as def
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname like 'record_activity_audit%' order by 1, 2`);
    expect(rows.map((row) => `${row.table}.${row.name}`)).toEqual([
      'club_memberships.record_activity_audit', 'clubs.record_activity_audit', 'daily_stock_counts.record_activity_audit',
      'debt_payments.record_activity_audit', 'expense_presets.record_activity_audit', 'new_debts.record_activity_audit',
      'owner_profit_carryovers.record_activity_audit', 'owner_reserve_entries.record_activity_audit_collected',
      'owner_withdrawals.record_activity_audit', 'products.record_activity_audit', 'promotions.record_activity_audit',
      'salary_employees.record_activity_audit', 'salary_entries.record_activity_audit',
      'salary_entries.record_activity_audit_recovery', 'stock_purchases.record_activity_audit',
    ]);
    const def = (name: string) => rows.find((row) => `${row.table}.${row.name}` === name)!.def;
    expect(def('club_memberships.record_activity_audit')).toMatch(/AFTER INSERT OR DELETE OR UPDATE .*record_activity_audit\('club_id', 'user_id', 'role', 'feature_access'\)/);
    expect(def('clubs.record_activity_audit')).toMatch(/AFTER UPDATE .*record_activity_audit\('id', 'id', 'name', 'address'/);
    expect(def('daily_stock_counts.record_activity_audit')).toMatch(/AFTER UPDATE .*'closing_stock', 'adjustment_quantity', 'adjustment_reason'\)/);
    expect(def('owner_withdrawals.record_activity_audit')).toMatch(/AFTER INSERT ON .*record_activity_audit\('club_id', 'id'\)/);
    expect(def('salary_entries.record_activity_audit_recovery')).toMatch(/WHEN \(\(new\.cash_shortage_id IS NOT NULL\)\)/);
    expect(def('owner_reserve_entries.record_activity_audit_collected')).toMatch(/WHEN \(new\.from_collected\)/);
  });

  it('names in /history exactly the tables only 183 logs', async () => {
    const { rows } = await db.query<{ table: string }>(`
      select distinct c.relname as table from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname like 'record_activity_audit%'
        and not exists (select 1 from pg_trigger e where e.tgrelid = t.tgrelid and e.tgname = 'record_entry_audit')
      order by 1`);
    expect(rows.map((row) => row.table)).toEqual([...ACTIVITY_ONLY_TABLES].sort());
  });

  it('accepts only consistent rows', async () => {
    const insert = (action: string, oldRow: string, newRow: string) => db.query(
      `insert into public.entry_audit_logs (club_id, table_name, action, old_row, new_row, changed_on)
       values ($1, 'products', $2, ${oldRow}, ${newRow}, '2024-08-03')`, [club, action],
    );
    await expect(insert('insert', `'{}'`, `'{}'`)).rejects.toThrow(/entry_audit_logs_new_row_matches_action/);
    await expect(insert('update', 'null', `'{}'`)).rejects.toThrow(/entry_audit_logs_new_row_matches_action/);
    await expect(insert('delete', `'{}'`, `'{}'`)).rejects.toThrow(/entry_audit_logs_new_row_matches_action/);
    await expect(insert('restore', `'{}'`, 'null')).rejects.toThrow(/entry_audit_logs_action_valid/);
  });

  it('lets only the service role claim pending notices, oldest first, each once', async () => {
    for (const call of [
      'select * from public.claim_activity_notices($1)',
      'select public.release_activity_notices($1, array[1]::bigint[])',
    ]) {
      await expect(asRole('authenticated', () => db.query(call, [club]))).rejects.toThrow(/permission denied/);
    }
    await expect(asRole('authenticated', () => db.query('select public.expire_activity_notices()'))).rejects.toThrow(/permission denied/);

    // Another club's notice stays with that club.
    await signedIn(() => db.query(`update public.clubs set name = 'Other branch' where id = $1`, [otherClub]));
    // A notice older than three days is never handed out.
    const pending = (await logs()).filter((row) => row.club_id === club && row.notice_pending);
    await db.query(`update public.entry_audit_logs set changed_at = now() - interval '4 days' where id = $1`, [pending[0].id]);

    const first = await asRole('service_role', () => db.query<LogRow>('select * from public.claim_activity_notices($1, 2)', [club]));
    expect(first.rows.map((row) => row.id)).toEqual([pending[1].id, pending[2].id]);
    expect(first.rows.every((row) => row.notice_pending === false)).toBe(true);
    claimedFirst = first.rows.map((row) => row.id);

    const rest = await asRole('service_role', () => db.query<LogRow>('select * from public.claim_activity_notices($1, 200)', [club]));
    expect(rest.rows.map((row) => row.id)).toEqual(pending.slice(3).map((row) => row.id));
    const again = await asRole('service_role', () => db.query('select * from public.claim_activity_notices($1)', [club]));
    expect(again.rows).toEqual([]);
    expect((await logs('clubs')).filter((row) => row.club_id === otherClub && row.notice_pending)).toHaveLength(1);
  });

  it('gives unsent rows back to the next sender, only for that club and only while young', async () => {
    const claimedIds = claimedFirst;
    const otherRow = (await logs('clubs')).find((row) => row.club_id === otherClub)!;
    const stale = (await logs()).find((row) => row.club_id === club && row.notice_pending)!;
    const released = await asRole('service_role', () => db.query<{ n: number }>(
      'select public.release_activity_notices($1, $2::bigint[]) as n', [club, [...claimedIds, otherRow.id, stale.id]],
    ));
    expect(released.rows[0].n).toBe(2);
    const reclaimed = await asRole('service_role', () => db.query<LogRow>('select * from public.claim_activity_notices($1)', [club]));
    expect(reclaimed.rows.map((row) => row.id)).toEqual(claimedIds);
  });

  it('expires every club\'s pending rows older than three days', async () => {
    await db.query(`update public.entry_audit_logs set changed_at = now() - interval '5 days' where club_id = $1`, [otherClub]);
    const expired = await asRole('service_role', () => db.query<{ n: number }>('select public.expire_activity_notices() as n'));
    // The stale row of this club and the other club's settings change.
    expect(expired.rows[0].n).toBe(2);
    expect((await logs()).filter((row) => row.notice_pending)).toEqual([]);
  });

  it('still lets a whole club be deleted, taking its history with it', async () => {
    await signedIn(() => db.query(`update public.clubs set name = 'Closed club' where id = $1`, [emptyClub]));
    expect((await logs()).some((row) => row.club_id === emptyClub)).toBe(true);
    await db.query('delete from public.clubs where id = $1', [emptyClub]);
    expect((await logs()).filter((row) => row.club_id === emptyClub)).toEqual([]);
  });
});
