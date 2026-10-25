import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const readMigration = (name: string) => readFileSync(resolve(process.cwd(), 'migrations', name), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
let db: PGlite;

async function asOwner<T>(work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const run = (sql: string) => asOwner(() => db.exec(sql));
const count = async (table: string) => (await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth; grant usage on schema public, auth to authenticated;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${owner}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.clubs (id uuid primary key);
    insert into public.clubs values ('${club}'),('${otherClub}');
    create table public.club_memberships (club_id uuid, user_id uuid, role text, feature_access text[]);
    insert into public.club_memberships values ('${club}','${owner}','owner',null),('${otherClub}','${owner}','owner',null);
    create function public.current_user_club_role(p_club_id uuid) returns text language sql stable security definer set search_path=public as $$
      select role from public.club_memberships where club_id=p_club_id and user_id=auth.uid()
    $$;
    create function public.current_user_can_access_club_feature(p_club_id uuid, p_feature_key text) returns boolean language sql stable security definer set search_path=public as $$
      select coalesce((select role = 'owner' from public.club_memberships where club_id=p_club_id and user_id=auth.uid()), false)
    $$;
    create function public.current_user_readable_clubs(p_feature_keys text[]) returns setof uuid language sql stable security definer set search_path=public as $$
      select club_id from public.club_memberships where user_id = auth.uid()
    $$;
    create function public.club_business_date(p_club_id uuid, p_at timestamptz default now()) returns date language sql stable as $$ select date '2026-10-25' $$;
    create table public.daily_cash_entries (id serial primary key, club_id uuid references public.clubs(id) on delete cascade, date date, cash_income numeric);
    create table public.expenses (id serial primary key, club_id uuid references public.clubs(id) on delete cascade, date date, amount numeric, comment text, telegram_chat_id text, telegram_message_id bigint);
    create table public.new_debts (id serial primary key, club_id uuid references public.clubs(id) on delete cascade, date date, amount numeric, remaining_amount numeric);
    create table public.debt_payments (id serial primary key, club_id uuid references public.clubs(id) on delete cascade, debt_id int references public.new_debts(id) on delete cascade, date date, amount numeric);
    create table public.money_exchanges (id serial primary key, club_id uuid references public.clubs(id) on delete cascade, date date, from_amount numeric);
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage on all sequences in schema public to authenticated;
    insert into public.daily_cash_entries (club_id, date, cash_income) values ('${club}','2026-10-24',100);
    insert into public.expenses (club_id, date, amount) values ('${club}','2026-10-24',10),('${club}','2026-10-23',5);
    insert into public.new_debts (club_id, date, amount, remaining_amount) values ('${club}','2026-10-24',50,50);
  `);
  for (const sql of [readMigration('096_daily_cash_collections.sql'), readMigration('097_collected_day_lock.sql'), readMigration('097_collected_day_lock.sql')]) {
    await db.exec(sql);
  }
  await asOwner(() => db.query('select public.mark_daily_cash_collected($1, $2)', [club, '2026-10-24']));
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('collected day lock (097)', () => {
  it('refuses new income and expenses on a collected day', async () => {
    await expect(run(`insert into public.daily_cash_entries (club_id, date, cash_income) values ('${club}','2026-10-24',1)`)).rejects.toThrow(/day is closed/);
    await expect(run(`insert into public.expenses (club_id, date, amount) values ('${club}','2026-10-24',1)`)).rejects.toThrow(/day is closed/);
    await expect(run(`insert into public.new_debts (club_id, date, amount, remaining_amount) values ('${club}','2026-10-24',1,1)`)).rejects.toThrow(/day is closed/);
    await expect(run(`insert into public.debt_payments (club_id, debt_id, date, amount) values ('${club}',1,'2026-10-24',1)`)).rejects.toThrow(/day is closed/);
    await expect(run(`insert into public.money_exchanges (club_id, date, from_amount) values ('${club}','2026-10-24',1)`)).rejects.toThrow(/day is closed/);
  });

  it('refuses editing, deleting or moving entries into or out of a collected day', async () => {
    await expect(run(`update public.expenses set comment = 'x' where date = '2026-10-24'`)).rejects.toThrow(/day is closed/);
    await expect(run(`delete from public.daily_cash_entries where date = '2026-10-24'`)).rejects.toThrow(/day is closed/);
    await expect(run(`update public.expenses set date = '2026-10-24' where date = '2026-10-23'`)).rejects.toThrow(/day is closed/);
    await expect(run(`update public.expenses set date = '2026-10-22' where date = '2026-10-24'`)).rejects.toThrow(/day is closed/);
    expect(await count('expenses')).toBe(2);
  });

  it('still saves the Telegram message of a closed-day entry', async () => {
    await run(`update public.expenses set telegram_chat_id = '-100', telegram_message_id = 7 where date = '2026-10-24'`);
  });

  it('reports a distinct error code the app can recognise', async () => {
    const error = await run(`insert into public.expenses (club_id, date, amount) values ('${club}','2026-10-24',1)`).catch((caught) => caught);
    expect(error).toMatchObject({ code: '55000', hint: 'day_collected' });
  });

  it('keeps other days, other clubs and later payments of a closed-day debt open', async () => {
    await run(`insert into public.expenses (club_id, date, amount) values ('${club}','2026-10-25',1),('${otherClub}','2026-10-24',1)`);
    await run(`insert into public.debt_payments (club_id, debt_id, date, amount) values ('${club}',1,'2026-10-25',20)`);
    await run(`update public.new_debts set remaining_amount = 30 where id = 1`);
    expect(await count('expenses')).toBe(4);
  });

  it('reopens the day once the owner removes the tick', async () => {
    await asOwner(() => db.query('select public.unmark_daily_cash_collected($1, $2)', [club, '2026-10-24']));
    await run(`insert into public.expenses (club_id, date, amount) values ('${club}','2026-10-24',1)`);
    await asOwner(() => db.query('select public.mark_daily_cash_collected($1, $2)', [club, '2026-10-24']));
  });

  it('still lets a whole club be deleted with its closed days', async () => {
    await db.exec(`delete from public.clubs where id = '${club}'`);
    expect(await count('daily_cash_entries')).toBe(0);
    expect(await count('daily_cash_collections')).toBe(0);
  });
});
