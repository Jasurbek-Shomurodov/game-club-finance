import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 185 on the full replayed schema: Pixel's two dollar expenses repriced at what their dollars cost. */

const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
const reprice = readMigration('185_pixel_dollar_expenses_at_cost.sql');
const owner = '00000000-0000-0000-0000-000000000001';
const club = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305';
const rent = '2d1e9e57-435d-4101-a6fb-a5bfcbd6c582';
const equipment = 'bccc7d32-a709-4550-b9a0-f83367aee84b';
let db: PGlite;

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
  // 185 runs here too, on a database without the club's rows.
  for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()) {
    await db.exec(readMigration(name));
  }
  await db.exec(`
    insert into auth.users values ('${owner}','o@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Pixel Gaming');
    insert into public.club_memberships (club_id, user_id, role) values ('${club}','${owner}','owner');
    insert into public.money_exchanges (id, club_id, date, from_method, to_method, from_amount, to_amount, rate, comment, created_by) values
      (gen_random_uuid(),'${club}','2026-10-31','terminal','usd',16863000,1400,12045,'bought dollars for the hall rent','${owner}'),
      (gen_random_uuid(),'${club}','2026-10-31','terminal','usd',4356275,365,11935,'bought dollars from the bank receipt','${owner}');
    -- As they were booked before 184, at a typed 12 000 a dollar. The fixture's
    -- 24 November may be ahead of the clock's business date.
    alter table public.expenses disable trigger trg_expense_date_guard;
    insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by, usd_amount, usd_rate) values
      ('${rent}','${club}','2026-10-31',15000000,'rent','usd','game_club','paid the October hall rent in dollars','${owner}',1250,12000),
      ('${equipment}','${club}','2026-11-24',1080000,'equipment','usd','game_club','bought new equipment for the hall','${owner}',90,12000);
    alter table public.expenses enable trigger trg_expense_date_guard;
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

/** Each case starts from the rows as production holds them and leaves nothing behind. */
async function inTransaction(work: () => Promise<void>) {
  await db.exec('begin');
  try { await work(); } finally { await db.exec('rollback'); }
}
/** Runs the migration where it may raise, keeping the transaction usable afterwards. */
async function repriceExpectingError(): Promise<unknown> {
  await db.exec('savepoint before_reprice');
  try {
    await db.exec(reprice);
  } catch (error) {
    await db.exec('rollback to savepoint before_reprice');
    return error;
  }
  throw new Error('185 did not raise');
}
const row = async (id: string) => {
  const found = (await db.query<{ amount: string; usd_rate: string; usd_amount: string }>(
    'select amount, usd_rate, usd_amount from public.expenses where id = $1', [id],
  )).rows[0];
  return found && { amount: Number(found.amount), usdRate: Number(found.usd_rate), usdAmount: Number(found.usd_amount) };
};
const num = async (sql: string, args: unknown[] = []) => {
  const value = Object.values((await db.query<Record<string, string | null>>(sql, args)).rows[0])[0];
  return value === null ? null : Number(value);
};
const audits = () => db.query<{ row_id: string; old_row: { amount: number; usd_rate: number }; changed_by: string | null; notice_pending: boolean }>(
  "select row_id, old_row, changed_by, notice_pending from public.entry_audit_logs where table_name = 'expenses' and action = 'update' order by id",
);
const oldRent = { amount: 15_000_000, usdRate: 12_000, usdAmount: 1_250 };
const newRent = { amount: 15_027_813, usdRate: 12_022.25, usdAmount: 1_250 };
const oldEquipment = { amount: 1_080_000, usdRate: 12_000, usdAmount: 90 };
const newEquipment = { amount: 1_082_003, usdRate: 12_022.26, usdAmount: 90 };

describe('Pixel dollar expenses repriced at cost (185)', () => {
  it('passes through exactly the UPDATE triggers its header names, none disabled', async () => {
    const triggers = (await db.query<{ tgname: string; tgenabled: string }>(`
      select tgname, tgenabled from pg_trigger
      where tgrelid = 'public.expenses'::regclass and not tgisinternal and (tgtype & 16) = 16
      order by tgname`)).rows;
    expect(triggers.map((trigger) => trigger.tgname)).toEqual([
      'expenses_cash_shortage_guard', 'expenses_collected_guard', 'expenses_method_balance', 'expenses_never_negative',
      'expenses_reserve_guard', 'lock_collected_day', 'protect_salary_expense', 'record_entry_audit',
    ]);
    expect(triggers.every((trigger) => trigger.tgenabled === 'O')).toBe(true);
  });

  it('reprices both rows in date order and keeps the old rows in the entry history', async () => {
    await inTransaction(async () => {
      expect(await row(rent)).toEqual(oldRent);
      await db.exec(reprice);
      expect(await row(rent)).toEqual(newRent);
      expect(await row(equipment)).toEqual(newEquipment);

      // $425 left that cost 5 109 459, 12 022.26 a dollar.
      expect(await num('select public.dollar_cost_rate($1) as v', [club])).toBe(12_022.26);
      expect(await num("select public.expense_method_balance($1,'usd',$2) as v", [club, '2026-11-24'])).toBe(425);
      expect(await num("select public.owner_reserve_balance($1,'game_club','usd') as v", [club])).toBe(5_109_459);

      const logged = (await audits()).rows;
      expect(logged.map((entry) => entry.row_id)).toEqual([rent, equipment]);
      expect(logged.map((entry) => [Number(entry.old_row.amount), Number(entry.old_row.usd_rate)]))
        .toEqual([[15_000_000, 12_000], [1_080_000, 12_000]]);
      expect(logged.every((entry) => entry.changed_by === null && !entry.notice_pending)).toBe(true);
    });
  });

  it('prices each row as the 184 trigger would have, in date order', async () => {
    // Rent first: every dollar bought, none spent.
    expect(Math.round((21_219_275 / 1_765) * 100) / 100).toBe(newRent.usdRate);
    expect(Math.round(1_250 * newRent.usdRate)).toBe(newRent.amount);
    // Then the equipment, from what the rent left.
    expect(Math.round(((21_219_275 - newRent.amount) / 515) * 100) / 100).toBe(newEquipment.usdRate);
    expect(Math.round(90 * newEquipment.usdRate)).toBe(newEquipment.amount);
  });

  it('changes nothing when run a second time', async () => {
    await inTransaction(async () => {
      await db.exec(reprice);
      await db.exec(reprice);
      expect(await row(rent)).toEqual(newRent);
      expect(await row(equipment)).toEqual(newEquipment);
      expect((await audits()).rows).toHaveLength(2);
    });
  });

  it('reprices only the row still at 12 000 when the other is already repriced', async () => {
    await inTransaction(async () => {
      await db.query('update public.expenses set usd_rate = 12022.25, amount = 15027813 where id = $1', [rent]);
      await db.exec(reprice);
      expect(await row(rent)).toEqual(newRent);
      expect(await row(equipment)).toEqual(newEquipment);
      expect((await audits()).rows.map((entry) => entry.row_id)).toEqual([rent, equipment]);
    });
  });

  it('stops without changing either row when one is in another state', async () => {
    await inTransaction(async () => {
      await db.query('update public.expenses set usd_rate = 12010, amount = 1080900 where id = $1', [equipment]);
      expect(String(await repriceExpectingError())).toMatch(/bccc7d32 is neither at 12 000 nor repriced/);
      expect(await row(rent)).toEqual(oldRent);
      expect(await row(equipment)).toEqual({ ...oldEquipment, amount: 1_080_900, usdRate: 12_010 });
    });
  });

  it('stops when the dollars bought are no longer the two exchanges the rates came from', async () => {
    await inTransaction(async () => {
      await db.exec(`insert into public.money_exchanges (id, club_id, date, from_method, to_method, from_amount, to_amount, rate, comment, created_by)
        values (gen_random_uuid(),'${club}','2026-11-01','cash','usd',1200000,100,12000,'bought more dollars for later','${owner}')`);
      expect(String(await repriceExpectingError())).toMatch(/dollar exchanges changed/);
      expect(await row(rent)).toEqual(oldRent);
      expect(await row(equipment)).toEqual(oldEquipment);
    });
  });

  it('stops when the club has another dollar expense', async () => {
    await inTransaction(async () => {
      await db.exec(`insert into public.expenses (club_id, date, amount, category, payment_method, payment_source, comment, created_by, usd_amount, usd_rate)
        values ('${club}','2026-11-01',120000,'equipment','usd','game_club','paid a small bill in dollars','${owner}',10,12000)`);
      expect(String(await repriceExpectingError())).toMatch(/3 dollar expenses/);
      expect(await row(rent)).toEqual(oldRent);
    });
  });

  it('stops on a collected day instead of lifting its lock', async () => {
    await inTransaction(async () => {
      await db.exec(`insert into public.daily_cash_collections (club_id, date, collected_by) values ('${club}','2026-10-31','${owner}')`);
      expect(await repriceExpectingError()).toMatchObject({ code: '55000', hint: 'day_collected' });
      expect(await row(rent)).toEqual(oldRent);
      expect(await row(equipment)).toEqual(oldEquipment);
    });
  });

  it('changes nothing where the rows are not in the database, and stops when only one is', async () => {
    await inTransaction(async () => {
      await db.query('delete from public.expenses where id = $1', [equipment]);
      expect(String(await repriceExpectingError())).toMatch(/Only one of the dollar expenses/);
      expect(await row(rent)).toEqual(oldRent);
      await db.query('delete from public.expenses where id = $1', [rent]);
      await db.exec(reprice);
      expect(await num("select count(*) as v from public.expenses where payment_method = 'usd'")).toBe(0);
    });
  });
});
