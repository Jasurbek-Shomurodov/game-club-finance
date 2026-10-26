import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 092 on the full replayed schema: exchange RPCs and the withdrawal limit they feed. */

const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
const club = '10000000-0000-0000-0000-000000000001';
const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const record = (n: number, from: string, to: string, amount: number, rate: number | null, userId = admin, date = '2024-08-05') => asUser(userId, () => db.query<{ exchange_id: string; created: boolean }>(
  'select * from record_money_exchange($1,$2,$3,$4,$5,$6,$7,$8)', [id(n), club, date, from, to, amount, rate, ' changed money for the rent '],
));

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
    insert into auth.users values ('${owner}','o@x.test'),('${admin}','a@x.test'),('${viewer}','v@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Club');
    update public.clubs set enabled_payment_methods = array['cash','terminal','card'] where id = '${club}';
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner'),('${club}','${admin}','admin');
    insert into public.club_memberships (club_id, user_id, role, feature_access) values ('${club}','${viewer}','admin', array['reports']);
    insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
      values ('${club}','2024-08-02',2000000,1000000,0,0,'${owner}');
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('money exchanges (092)', () => {
  it('converts with the typed rate and records a retried id once', async () => {
    expect((await record(1, 'cash', 'usd', 1_265_000, 12_650)).rows).toEqual([{ exchange_id: id(1), created: true }]);
    expect((await record(1, 'cash', 'usd', 1_265_000, 12_650)).rows).toEqual([{ exchange_id: id(1), created: false }]);
    await record(2, 'usd', 'terminal', 10.5, 12_700);
    await record(3, 'terminal', 'card', 300_000, null);
    const rows = (await db.query('select from_method, to_method, from_amount, to_amount, rate, comment from money_exchanges order by id')).rows;
    expect(rows).toEqual([
      { from_method: 'cash', to_method: 'usd', from_amount: '1265000.00', to_amount: '100.00', rate: '12650.00', comment: 'changed money for the rent' },
      { from_method: 'usd', to_method: 'terminal', from_amount: '10.50', to_amount: '133350.00', rate: '12700.00', comment: 'changed money for the rent' },
      { from_method: 'terminal', to_method: 'card', from_amount: '300000.00', to_amount: '300000.00', rate: null, comment: 'changed money for the rent' },
    ]);
  });

  it('rejects a reused id, bad values and members without expense access', async () => {
    await expect(record(1, 'cash', 'usd', 1_000, 12_650)).rejects.toMatchObject({ code: '23505' });
    await expect(record(4, 'cash', 'cash', 1_000, null)).rejects.toThrow('Invalid money exchange');
    await expect(record(4, 'cash', 'usd', 1_000, null)).rejects.toThrow('Invalid money exchange');
    await expect(record(4, 'cash', 'card', 10.5, null)).rejects.toThrow('Invalid money exchange');
    await expect(record(4, 'cash', 'card', 1_000, null, admin, '2999-01-01')).rejects.toThrow('Invalid money exchange');
    await expect(record(4, 'cash', 'card', 1_000, null, viewer)).rejects.toMatchObject({ code: '42501' });
    await db.exec(`update public.clubs set enabled_payment_methods = array['cash','terminal'] where id = '${club}'`);
    await expect(record(4, 'cash', 'card', 1_000, null)).rejects.toThrow('not enabled');
    await db.exec(`update public.clubs set enabled_payment_methods = array['cash','terminal','card'] where id = '${club}'`);
    await expect(asUser(admin, () => db.query(`insert into money_exchanges (id, club_id, date, from_method, to_method, from_amount, to_amount) values ($1,$2,'2024-08-05','cash','card',1,1)`, [id(9), club])))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('moves the per-method owner withdrawal limit', async () => {
    // Cash 2 000 000 - 1 265 000 to dollars; terminal 1 000 000 + 133 350 from dollars - 300 000 to card.
    const earned = async (method: string) => Number((await db.query<{ v: string }>(
      'select owner_payment_method_earned_for_month($1,$2,$3) as v', [club, method, '2024-08-01'],
    )).rows[0].v);
    expect(await earned('cash')).toBe(735_000);
    expect(await earned('terminal')).toBe(833_350);
    expect(await earned('card')).toBe(300_000);
  });

  it('lets only owners delete', async () => {
    await expect(asUser(admin, () => db.query('select delete_money_exchange($1,$2)', [club, id(3)]))).rejects.toMatchObject({ code: '42501' });
    await asUser(owner, () => db.query('select delete_money_exchange($1,$2)', [club, id(3)]));
    await expect(asUser(owner, () => db.query('select delete_money_exchange($1,$2)', [club, id(3)]))).rejects.toMatchObject({ code: 'P0002' });
  });

  it('saves Telegram coordinates once, and salary records get theirs too (090)', async () => {
    await asUser(admin, () => db.query('select set_money_exchange_telegram_message($1,$2,$3,$4)', [club, id(1), '-1001', 7]));
    await asUser(admin, () => db.query('select set_money_exchange_telegram_message($1,$2,$3,$4)', [club, id(1), '-1001', 99]));
    expect((await db.query('select telegram_chat_id, telegram_message_id from money_exchanges where id = $1', [id(1)])).rows)
      .toEqual([{ telegram_chat_id: '-1001', telegram_message_id: 7 }]);
    const columns = (await db.query<{ table_name: string }>(
      "select table_name from information_schema.columns where column_name = 'telegram_message_id' and table_name in ('salary_entries','salary_rates') order by 1",
    )).rows.map((row) => row.table_name);
    expect(columns).toEqual(['salary_entries', 'salary_rates']);
  });

  it('lets only owners change an ordinary expense\'s payment method (090)', async () => {
    const expense = id(50);
    await db.query(
      `insert into expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by) values ($1,$2,'2024-08-05',5000,'repair','cash','game_club','fixed the broken front door',$3)`,
      [expense, club, owner],
    );
    const change = (method: string, userId = owner) => asUser(userId, () => db.query('select update_expense_payment_method($1,$2,$3)', [club, expense, method]));
    await expect(change('card', admin)).rejects.toMatchObject({ code: '42501' });
    await expect(change('usd')).rejects.toThrow('Invalid payment method');
    await change('card');
    expect((await db.query('select payment_method, amount from expenses where id = $1', [expense])).rows).toEqual([{ payment_method: 'card', amount: '5000' }]);
    await expect(asUser(owner, () => db.query('select update_expense_payment_method($1,$2,$3)', [club, id(51), 'cash']))).rejects.toMatchObject({ code: 'P0002' });
  });
});
