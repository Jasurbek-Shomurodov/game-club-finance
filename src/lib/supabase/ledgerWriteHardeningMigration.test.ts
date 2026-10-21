import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sql = readFileSync(resolve('migrations', '086_ledger_write_hardening.sql'), 'utf8');
const club = '10000000-0000-0000-0000-000000000001';
const admin = '20000000-0000-0000-0000-000000000001';
const owner = '20000000-0000-0000-0000-000000000002';
const debt = '30000000-0000-0000-0000-000000000001';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${admin}'), ('${owner}');
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
    create function public.current_user_club_role(id uuid) returns text language sql as $$ select 'owner' $$;
    create function public.current_user_can_access_club_feature(id uuid, feature text) returns boolean language sql as $$ select true $$;
    create function public.club_business_date(id uuid) returns date language sql as $$ select date '2026-10-15' $$;

    create table public.daily_stock_counts(id serial primary key, club_id uuid, sale_price numeric);
    alter table public.daily_stock_counts enable row level security;
    create policy club_read_stock_counts on public.daily_stock_counts for select using (true);
    create policy club_admin_insert_stock_counts on public.daily_stock_counts for insert with check (true);
    create policy club_admin_update_stock_counts on public.daily_stock_counts for update using (true) with check (true);
    create policy club_admin_delete_stock_counts on public.daily_stock_counts for delete using (true);
    grant select, insert, update, delete on public.daily_stock_counts to authenticated;
    grant usage, select on sequence public.daily_stock_counts_id_seq to authenticated;
    insert into public.daily_stock_counts(club_id, sale_price) values ('${club}', 1000);

    create table public.expenses(id serial primary key, club_id uuid not null, date date not null, amount numeric, created_by uuid);
    alter table public.expenses enable row level security;
    create policy club_read_expenses on public.expenses for select using (true);
    create policy club_admin_insert_expenses on public.expenses for insert with check (true);
    grant select, insert on public.expenses to authenticated;
    grant usage, select on sequence public.expenses_id_seq to authenticated;

    create table public.debt_payments(id serial primary key, club_id uuid not null, debt_id uuid, amount numeric);
    alter table public.debt_payments enable row level security;
    create policy club_read_debt_payments on public.debt_payments for select using (true);
    create policy club_admin_insert_debt_payments on public.debt_payments for insert with check (true);
    grant select, insert on public.debt_payments to authenticated;
    grant usage, select on sequence public.debt_payments_id_seq to authenticated;

    create table public.profiles(id uuid primary key, role text);
    alter table public.profiles enable row level security;
    create policy profiles_read on public.profiles for select using (true);
    create policy profiles_update_owner_only on public.profiles for update using (true) with check (true);
    grant select, update on public.profiles to authenticated, anon;
    insert into public.profiles values ('${admin}', 'admin');

    create function public.handle_debt_payment() returns trigger language plpgsql as $$ begin return new; end; $$;
  `);
  await db.exec(sql);
  await db.exec(sql); // re-runnable
});

afterAll(async () => { await db.close(); });

async function asUser(actor: string, statement: string) {
  await db.exec(`set test.actor = '${actor}'; set role authenticated`);
  try {
    return await db.query<Record<string, unknown>>(statement);
  } finally {
    await db.exec('reset role; reset test.actor');
  }
}

describe('086 ledger write hardening', () => {
  it('leaves no direct write path to closing stock snapshots', async () => {
    const updated = await asUser(admin, `update public.daily_stock_counts set sale_price = 999999 returning id`);
    expect(updated.rows).toEqual([]);
    await expect(asUser(admin, `insert into public.daily_stock_counts(club_id, sale_price) values ('${club}', 1)`))
      .rejects.toThrow(/row-level security/);
    const { rows } = await db.query<{ sale_price: string }>('select sale_price from public.daily_stock_counts');
    expect(Number(rows[0].sale_price)).toBe(1000);
  });

  it('records the signed-in user as the expense author and refuses a forged one', async () => {
    await asUser(admin, `insert into public.expenses(club_id, date, amount) values ('${club}', '2026-10-15', 10)`);
    const { rows } = await db.query<{ created_by: string }>('select created_by from public.expenses');
    expect(rows[0].created_by).toBe(admin);
    await expect(asUser(admin, `insert into public.expenses(club_id, date, amount, created_by) values ('${club}', '2026-10-14', 10, '${owner}')`))
      .rejects.toThrow(/row-level security/);
  });

  it('rejects an expense dated after the club business date', async () => {
    await expect(asUser(admin, `insert into public.expenses(club_id, date, amount) values ('${club}', '2026-10-16', 10)`))
      .rejects.toThrow(/future business date/);
  });

  it('records the signed-in user as the debt payment author and refuses a forged one', async () => {
    await asUser(admin, `insert into public.debt_payments(club_id, debt_id, amount) values ('${club}', '${debt}', 5)`);
    const { rows } = await db.query<{ created_by: string }>('select created_by from public.debt_payments');
    expect(rows[0].created_by).toBe(admin);
    await expect(asUser(admin, `insert into public.debt_payments(club_id, debt_id, amount, created_by) values ('${club}', '${debt}', 5, '${owner}')`))
      .rejects.toThrow(/row-level security/);
  });

  it('denies browser roles any profile update', async () => {
    await expect(asUser(owner, `update public.profiles set role = 'owner' where id = '${admin}'`))
      .rejects.toThrow(/permission denied/);
  });

  it('pins the legacy trigger function search_path', async () => {
    const { rows } = await db.query<{ proconfig: string[] }>("select proconfig from pg_proc where proname = 'handle_debt_payment'");
    expect(rows[0].proconfig).toContain('search_path=public');
  });
});
