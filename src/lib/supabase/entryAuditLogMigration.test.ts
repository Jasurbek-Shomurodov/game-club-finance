import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'migrations', '111_entry_audit_log.sql'), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
let db: PGlite;

async function as<T>(user: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
  try { return await work(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
}

interface LogRow { club_id: string; table_name: string; row_id: string; action: string; old_row: Record<string, unknown>; new_row: Record<string, unknown> | null; changed_by: string | null; changed_on: string }
const logs = async () => (await db.query<LogRow>('select * from public.entry_audit_logs order by id')).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth; grant usage on schema public, auth to authenticated;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${owner}'),('${admin}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.clubs (id uuid primary key);
    insert into public.clubs values ('${club}'),('${otherClub}');
    create table public.club_memberships (club_id uuid, user_id uuid, role text);
    insert into public.club_memberships values ('${club}','${owner}','owner'),('${club}','${admin}','admin'),('${otherClub}','${admin}','owner');
    create function public.current_user_club_role(p_club_id uuid) returns text language sql stable security definer set search_path=public as $$
      select role from public.club_memberships where club_id=p_club_id and user_id=auth.uid()
    $$;
    create function public.club_business_date(p_club_id uuid, p_at timestamptz default now()) returns date language sql stable as $$ select date '2026-10-25' $$;
    create table public.daily_cash_entries (id serial primary key, club_id uuid references public.clubs(id) on delete cascade, date date, cash_income numeric, updated_at timestamptz default now());
    create table public.expenses (id serial primary key, club_id uuid references public.clubs(id) on delete cascade, date date, amount numeric, comment text, telegram_chat_id text, telegram_message_id bigint);
    create table public.new_debts (id serial primary key, club_id uuid references public.clubs(id) on delete cascade, amount numeric, paid_amount numeric default 0, remaining_amount numeric, status text default 'open');
    create table public.money_exchanges (id serial primary key, club_id uuid references public.clubs(id) on delete cascade);
    create table public.stock_purchases (id serial primary key, club_id uuid references public.clubs(id) on delete cascade);
    create table public.owner_withdrawals (id serial primary key, club_id uuid references public.clubs(id) on delete cascade);
    create table public.owner_profit_carryovers (id serial primary key, club_id uuid references public.clubs(id) on delete cascade);
    create table public.debt_payments (id serial primary key, club_id uuid references public.clubs(id) on delete cascade);
    create table public.daily_cash_collections (club_id uuid references public.clubs(id) on delete cascade, date date, primary key (club_id, date));
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage on all sequences in schema public to authenticated;
    insert into public.daily_cash_entries (club_id, date, cash_income) values ('${club}','2026-10-24',100),('${otherClub}','2026-10-24',70);
    insert into public.expenses (club_id, date, amount, comment) values ('${club}','2026-10-24',10,'old note');
    insert into public.new_debts (club_id, amount, remaining_amount) values ('${club}',50,50);
    insert into public.daily_cash_collections values ('${club}','2026-10-23');
  `);
  await db.exec(migration);
  await db.exec(migration);
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('entry audit log (111)', () => {
  it('keeps the before and after of an edit with its author and business date', async () => {
    await as(admin, () => db.exec(`update public.daily_cash_entries set cash_income = 120 where club_id = '${club}'`));
    const [row] = await logs();
    expect(row).toMatchObject({ club_id: club, table_name: 'daily_cash_entries', row_id: '1', action: 'update', changed_by: admin });
    expect(row.old_row.cash_income).toBe(100);
    expect(row.new_row?.cash_income).toBe(120);
    expect(String(row.changed_on)).toContain('2026');
  });

  it('keeps a deleted row whole', async () => {
    await as(owner, () => db.exec(`delete from public.expenses where club_id = '${club}'`));
    const row = (await logs()).at(-1)!;
    expect(row).toMatchObject({ table_name: 'expenses', action: 'delete', new_row: null, changed_by: owner });
    expect(row.old_row).toMatchObject({ amount: 10, comment: 'old note' });
  });

  it('records a removed collected tick, which has no id column', async () => {
    await as(owner, () => db.exec(`delete from public.daily_cash_collections where club_id = '${club}'`));
    expect((await logs()).at(-1)).toMatchObject({ table_name: 'daily_cash_collections', row_id: null, action: 'delete' });
  });

  it('skips updates of Telegram coordinates and debt totals only', async () => {
    const before = (await logs()).length;
    await db.exec(`insert into public.expenses (club_id, date, amount) values ('${club}','2026-10-24',5)`);
    await db.exec(`update public.expenses set telegram_chat_id = '-100', telegram_message_id = 3`);
    await db.exec(`update public.new_debts set paid_amount = 20, remaining_amount = 30, status = 'partial'`);
    await db.exec(`update public.daily_cash_entries set updated_at = now() + interval '1 hour'`);
    expect((await logs()).length).toBe(before);
    await db.exec(`update public.new_debts set amount = 60`);
    expect((await logs()).at(-1)).toMatchObject({ table_name: 'new_debts', action: 'update', changed_by: null });
  });

  it('lets only owners of the club read it', async () => {
    const ownerRows = await as(owner, () => db.query('select * from public.entry_audit_logs'));
    expect(ownerRows.rows.length).toBe((await logs()).length);
    const adminRows = await as(admin, () => db.query('select * from public.entry_audit_logs'));
    expect(adminRows.rows).toEqual([]);
  });

  it('cannot be written, changed or erased through the API', async () => {
    await expect(as(owner, () => db.exec(`insert into public.entry_audit_logs (club_id, table_name, action, old_row, changed_on) values ('${club}','x','delete','{}','2026-10-25')`))).rejects.toThrow(/permission denied/);
    await expect(as(owner, () => db.exec('update public.entry_audit_logs set row_id = null'))).rejects.toThrow(/permission denied/);
    await expect(as(owner, () => db.exec('delete from public.entry_audit_logs'))).rejects.toThrow(/permission denied/);
    await expect(as(owner, () => db.query('select public.record_entry_audit()'))).rejects.toThrow();
  });

  it('covers every money ledger', async () => {
    const { rows } = await db.query<{ table: string }>(
      "select event_object_table as table from information_schema.triggers where trigger_name = 'record_entry_audit' group by 1 order by 1",
    );
    expect(rows.map((row) => row.table)).toEqual([
      'daily_cash_collections', 'daily_cash_entries', 'debt_payments', 'expenses', 'money_exchanges',
      'new_debts', 'owner_profit_carryovers', 'owner_withdrawals', 'stock_purchases',
    ]);
  });

  it('still lets a whole club be deleted, taking its history with it', async () => {
    await db.exec(`delete from public.clubs where id = '${club}'`);
    expect((await logs()).filter((row) => row.club_id === club)).toEqual([]);
    expect((await db.query('select * from public.daily_cash_entries')).rows.length).toBe(1);
  });
});
