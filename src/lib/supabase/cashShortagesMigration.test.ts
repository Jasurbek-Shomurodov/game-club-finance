import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Migration 135 on the full replayed schema: cash shortages, their expense, and salary recovery. */

const migrationsDir = resolve(process.cwd(), 'migrations');
const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const club = '10000000-0000-0000-0000-000000000001';
const employee = '30000000-0000-0000-0000-000000000001';
const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const note = 'Cash was missing at the evening handover';
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
      values ('${club}','2024-08-02',1000,0,0,0,'${owner}');
    insert into public.salary_employees (id, club_id, name, joined_on, created_by)
      values ('${employee}','${club}','Izzat','2024-01-01','${owner}');
  `);
}, 120_000);

afterAll(async () => { await db?.close(); });

const record = (n: number, options: { amount?: number; employee?: string | null; recover?: number; date?: string; method?: string; source?: string; comment?: string; userId?: string } = {}) => asUser(options.userId ?? owner, () => db.query<{ record_cash_shortage: boolean }>(
  'select record_cash_shortage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
  [club, id(n), options.date ?? '2024-08-03', options.source ?? 'game_club', options.method ?? 'cash', options.amount ?? 5000, 'stolen',
    options.employee === undefined ? employee : options.employee, options.comment ?? note, options.recover ?? 0, options.recover ? id(n + 500) : null],
));
const expenseFor = async (n: number) => (await db.query<{ id: string; amount: string; category: string; payment_method: string; comment: string }>(
  'select id, amount, category, payment_method, comment from public.expenses where cash_shortage_id = $1', [id(n)],
)).rows;
const recovered = async (n: number) => Number((await db.query<{ total: string }>(
  'select public.cash_shortage_recovered($1,$2) as total', [club, id(n)],
)).rows[0].total);

describe('cash shortages (135)', () => {
  it('records the shortage with one linked expense, even above what the method holds, and saves a retry once', async () => {
    expect((await record(1)).rows[0].record_cash_shortage).toBe(true);
    expect((await record(1)).rows[0].record_cash_shortage).toBe(false);
    const expenses = await expenseFor(1);
    expect(expenses).toHaveLength(1);
    expect(Number(expenses[0].amount)).toBe(5000);
    expect(expenses[0]).toMatchObject({ category: 'shortage', payment_method: 'cash', comment: `Izzat: ${note}` });
  });

  it('takes part back from salary as a fine that names the shortage', async () => {
    await record(2, { recover: 2000 });
    const fines = (await db.query<{ kind: string; amount: string; employee_id: string }>(
      'select kind, amount, employee_id from public.salary_entries where cash_shortage_id = $1', [id(2)],
    )).rows;
    expect(fines.map((fine) => ({ ...fine, amount: Number(fine.amount) }))).toEqual([{ kind: 'fine', amount: 2000, employee_id: employee }]);
    await asUser(owner, () => db.query('select recover_cash_shortage($1,$2,$3,$4)', [club, id(2), id(700), 3000]));
    expect(await recovered(2)).toBe(5000);
    await expect(asUser(owner, () => db.query('select recover_cash_shortage($1,$2,$3,$4)', [club, id(2), id(701), 1])))
      .rejects.toMatchObject({ hint: 'shortage_recovery_too_large' });
  });

  it('cannot recover from salary when nobody is responsible', async () => {
    await record(3, { employee: null });
    await expect(asUser(owner, () => db.query('select recover_cash_shortage($1,$2,$3,$4)', [club, id(3), id(702), 100])))
      .rejects.toMatchObject({ hint: 'shortage_no_employee' });
  });

  it('is owner-only to record and to read', async () => {
    await expect(record(4, { userId: admin })).rejects.toMatchObject({ code: '42501' });
    const visible = await asUser(admin, () => db.query('select id from public.cash_shortages'));
    expect(visible.rows).toEqual([]);
    const ownerRows = await asUser(owner, () => db.query('select id from public.cash_shortages'));
    expect(ownerRows.rows.length).toBeGreaterThan(0);
  });

  it('needs a 5-word note, a valid method and a date that is not in the future', async () => {
    await expect(record(5, { comment: 'missing' })).rejects.toMatchObject({ hint: 'note_required' });
    await expect(record(6, { source: 'bar', method: 'playstation' })).rejects.toMatchObject({ code: '23514' });
    await expect(record(7, { method: 'card' })).rejects.toThrow(/not enabled/);
    await expect(record(8, { date: '2999-01-01' })).rejects.toMatchObject({ code: '23514' });
  });

  it('protects the linked expense and refuses a hand-made shortage expense', async () => {
    const [expense] = await expenseFor(1);
    await expect(db.query('update public.expenses set amount = 1 where id = $1', [expense.id])).rejects.toMatchObject({ hint: 'shortage_expense' });
    await expect(db.query('delete from public.expenses where id = $1', [expense.id])).rejects.toMatchObject({ hint: 'shortage_expense' });
    await expect(db.query(
      `insert into public.expenses (club_id, date, amount, category, payment_method, payment_source, comment, created_by)
       values ($1,'2024-08-03',100,'shortage','cash','game_club','A shortage typed by hand here',$2)`, [club, owner],
    )).rejects.toMatchObject({ hint: 'shortage_expense' });
  });

  it('deletes only after its recovery fines are deleted, taking the expense with it and keeping the fines', async () => {
    await expect(asUser(owner, () => db.query('select delete_cash_shortage($1,$2)', [club, id(2)])))
      .rejects.toMatchObject({ hint: 'shortage_has_recoveries' });
    const fines = (await db.query<{ id: string }>('select id from public.salary_entries where cash_shortage_id = $1', [id(2)])).rows;
    for (const fine of fines) {
      await asUser(owner, () => db.query("select delete_salary_record($1,$2,'entry','Recorded by mistake')", [club, fine.id]));
    }
    expect(await recovered(2)).toBe(0);
    await asUser(owner, () => db.query('select delete_cash_shortage($1,$2)', [club, id(2)]));
    expect(await expenseFor(2)).toEqual([]);
    const kept = await db.query<{ cash_shortage_id: string | null; deleted_at: string | null }>(
      'select cash_shortage_id, deleted_at from public.salary_entries where id = any($1)', [fines.map((fine) => fine.id)],
    );
    expect(kept.rows.every((row) => row.cash_shortage_id === null && row.deleted_at !== null)).toBe(true);
    const audit = await db.query("select 1 from public.entry_audit_logs where table_name = 'cash_shortages' and row_id = $1", [id(2)]);
    expect(audit.rows).toHaveLength(1);
  });

  it('keeps a collected day closed', async () => {
    await db.exec(`insert into public.daily_cash_collections (club_id, date, collected_by) values ('${club}','2024-08-02','${owner}')`);
    await expect(record(9, { date: '2024-08-02' })).rejects.toMatchObject({ hint: 'day_collected' });
    expect((await db.query('select 1 from public.cash_shortages where id = $1', [id(9)])).rows).toEqual([]);
  });
});
