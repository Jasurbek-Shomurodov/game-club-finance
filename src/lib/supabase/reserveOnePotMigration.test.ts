import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 155 on the full replayed schema: the reserve's sums are one pot. */

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

const held = () => num('select public.owner_reserve_sums_held($1)', [club]);
const remove = (n: number) => call('select delete_owner_reserve_entry($1,$2)', [club, id(n)]);

describe('reserve as one pot (155)', () => {
  it('pays a purchase from sums saved in other methods', async () => {
    await deposit(1, 300, 'cash');
    await deposit(2, 200, 'terminal');
    expect(await held()).toBe(500);
    // Stored in cash, paid by the whole pot: more than the cash bucket alone.
    await purchase(10, 450);
    expect(await held()).toBe(50);
    await expect(purchase(11, 51)).rejects.toMatchObject({ hint: 'reserve_insufficient' });
    const balances = (await call<{ b: { sums: string } }>('select get_owner_reserve_balances($1) as b', [club])).rows[0].b;
    expect(Number(balances.sums)).toBe(50);
  });

  it('returns no more than the pot still holds, even when the bucket saved more', async () => {
    await expect(giveBack(20, 100, 'terminal')).rejects.toMatchObject({ hint: 'reserve_insufficient' });
    await giveBack(21, 50, 'terminal');
    expect(await held()).toBe(0);
  });

  it('refuses to undo a deposit the pot already spent, and allows it once freed', async () => {
    await expect(remove(1)).rejects.toMatchObject({ hint: 'reserve_already_used' });
    await db.query('delete from public.expenses where id = $1', [id(10)]);
    await remove(1);
    expect(await held()).toBe(150);
    // The terminal bucket gave 50 back, so only 150 of its 200 can be undone: the deposit is still in use.
    await expect(remove(2)).rejects.toMatchObject({ hint: 'reserve_already_used' });
    await remove(21);
    await remove(2);
    expect(await held()).toBe(0);
  });
});
