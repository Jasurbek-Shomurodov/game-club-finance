import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 136 on the full replayed schema: the owner reserve. */

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
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner'), ('${club}','${admin}','admin');
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',1000,200,0,0,'${owner}');
    -- Supabase's default table privileges; RLS and triggers still decide.
    grant select, insert on public.expenses to authenticated;
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

const aug = '2024-08-01';
const call = <T = unknown>(sql: string, params: unknown[], userId = owner) => asUser(userId, () => db.query<T>(sql, params));
const deposit = (n: number, amount: number, method: string | null = 'cash', source = 'game_club', userId = owner) => call(
  'select move_owner_profit_to_reserve($1,$2,$3,$4,$5,$6,$7) as created', [club, id(n), aug, source, method, amount, 'For new PCs'], userId,
);
const giveBack = (n: number, amount: number, method: string | null = 'cash') => call(
  'select return_owner_reserve($1,$2,$3,$4,$5,$6,$7)', [club, id(n), aug, 'game_club', method, amount, null],
);
const purchase = (n: number, amount: number, userId = owner, method = 'cash') => call(
  `insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by, paid_from_reserve)
   values ($1,$2,'2024-08-05',$3,'equipment',$4,'game_club','Two new gaming PCs for hall',$5,true)`, [id(n), club, amount, method, userId], userId,
);
const num = async (sql: string, params: unknown[]) => Number(Object.values((await db.query<Record<string, string>>(sql, params)).rows[0])[0]);
const available = (method: string | null = 'cash') => num('select public.owner_profit_bucket_available($1,$2,$3,$4)', [club, 'game_club', method, aug]);
const reserve = (method: string | null = 'cash') => num('select public.owner_reserve_balance($1,$2,$3)', [club, 'game_club', method]);
const expenseLimit = () => num('select public.expense_method_balance($1,$2,$3)', [club, 'cash', '2024-08-20']);

describe('owner reserve (136)', () => {
  it('takes a deposit out of the month like a withdrawal, never above what is left, and saves a retry once', async () => {
    expect(await available()).toBe(1000);
    expect((await deposit(1, 600)).rows[0]).toEqual({ created: true });
    expect((await deposit(1, 600)).rows[0]).toEqual({ created: false });
    expect(await available()).toBe(400);
    expect(await available(null)).toBe(600);
    expect(await reserve()).toBe(600);
    // Money set aside this month can no longer pay ordinary expenses.
    expect(await expenseLimit()).toBe(400);
    await expect(deposit(2, 401)).rejects.toMatchObject({ hint: 'reserve_exceeds_available' });
    await expect(call(
      'select withdraw_owner_game_club_money_by_method($1,$2,$3,$4,$5)', [club, aug, 'cash', 401, 'Taking the rest of cash home now'],
    )).rejects.toThrow();
  });

  it('pays an owner purchase from the reserve without touching the month', async () => {
    await purchase(10, 500);
    expect(await reserve()).toBe(100);
    expect(await available()).toBe(400);
    expect(await expenseLimit()).toBe(400);
    await expect(purchase(11, 101)).rejects.toMatchObject({ hint: 'reserve_insufficient' });
    await expect(purchase(12, 50, admin)).rejects.toMatchObject({ code: '42501' });
    await expect(purchase(13, 50, owner, 'terminal')).rejects.toMatchObject({ hint: 'reserve_insufficient' });
    await expect(db.query('update public.expenses set amount = 400 where id = $1', [id(10)])).rejects.toMatchObject({ hint: 'reserve_expense_locked' });
    await expect(db.query('update public.expenses set paid_from_reserve = false where id = $1', [id(10)])).rejects.toMatchObject({ hint: 'reserve_expense_locked' });
  });

  it('returns reserve money into a month, never more than it holds', async () => {
    await expect(giveBack(20, 101)).rejects.toMatchObject({ hint: 'reserve_insufficient' });
    await giveBack(21, 100);
    expect(await reserve()).toBe(0);
    expect(await available()).toBe(500);
  });

  it('refuses to delete a deposit whose money was already used, and allows it once freed', async () => {
    await expect(call('select delete_owner_reserve_entry($1,$2)', [club, id(1)])).rejects.toMatchObject({ hint: 'reserve_already_used' });
    await call('select delete_owner_reserve_entry($1,$2)', [club, id(21)]);
    await db.query('delete from public.expenses where id = $1', [id(10)]);
    await call('select delete_owner_reserve_entry($1,$2)', [club, id(1)]);
    expect(await reserve()).toBe(0);
    expect(await available()).toBe(1000);
    const audit = await db.query("select 1 from public.entry_audit_logs where table_name = 'owner_reserve_entries'");
    expect(audit.rows).toHaveLength(2);
  });

  it('keeps the Bar reserve without a method and the Game Club one per method', async () => {
    await deposit(30, 150, 'terminal');
    const balances = (await call<{ balances: Record<string, Record<string, string>> }>(
      'select get_owner_reserve_balances($1) as balances', [club],
    )).rows[0].balances;
    expect(Number(balances.game_club.total)).toBe(150);
    expect(Number(balances.game_club.terminal)).toBe(150);
    expect(Number(balances.bar.total)).toBe(0);
    await expect(deposit(31, 10, 'cash', 'bar')).rejects.toMatchObject({ code: '23514' });
  });

  it('is owner-only to use and to read through the balance RPC, and has no goals after 138', async () => {
    await expect(deposit(40, 10, 'cash', 'game_club', admin)).rejects.toMatchObject({ code: '42501' });
    await expect(call('select get_owner_reserve_balances($1)', [club], admin)).rejects.toMatchObject({ code: '42501' });
    const leftovers = await db.query<{ goals: string | null; setter: string | null }>(
      "select to_regclass('public.owner_reserve_goals')::text as goals, to_regprocedure('public.set_owner_reserve_goal(uuid,text,text,numeric)')::text as setter",
    );
    expect(leftovers.rows[0]).toEqual({ goals: null, setter: null });
  });
});
