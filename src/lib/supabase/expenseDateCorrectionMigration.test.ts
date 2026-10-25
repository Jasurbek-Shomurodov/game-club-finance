import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'migrations/095_expense_date_correction.sql'), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const expense = '30000000-0000-0000-0000-000000000001';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const move = (userId: string, date: string, clubId = club) => asUser(userId, () => db.query(
  'select public.update_expense_date($1, $2, $3)', [clubId, expense, date],
));
const dateOf = async () => (await db.query<{ date: string }>("select to_char(date, 'YYYY-MM-DD') as date from public.expenses")).rows[0].date;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth; grant usage on schema public, auth to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.club_memberships (club_id uuid, user_id uuid, role text);
    insert into public.club_memberships values ('${club}','${owner}','owner'),('${club}','${admin}','admin'),('${otherClub}','${owner}','owner');
    create function public.current_user_club_role(p_club_id uuid) returns text language sql stable security definer set search_path=public as $$
      select role from public.club_memberships where club_id=p_club_id and user_id=auth.uid()
    $$;
    create function public.club_business_date(p_club_id uuid, p_at timestamptz default now()) returns date language sql stable as $$ select date '2026-10-25' $$;
    create table public.expenses (id uuid primary key, club_id uuid not null, date date not null);
    insert into public.expenses values ('${expense}', '${club}', '2026-10-24');
  `);
  for (const sql of [migration, migration]) await db.exec(sql);
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('expense date correction (095)', () => {
  it('lets an owner move an expense up to the club business date', async () => {
    await move(owner, '2026-09-30');
    expect(await dateOf()).toBe('2026-09-30');
    await move(owner, '2026-10-25');
    expect(await dateOf()).toBe('2026-10-25');
  });

  it('refuses a future date, a non-owner and another club', async () => {
    await expect(move(owner, '2026-10-26')).rejects.toThrow(/future business date/);
    await expect(move(admin, '2026-10-01')).rejects.toThrow(/Only a club owner/);
    await expect(move(owner, '2026-10-01', otherClub)).rejects.toThrow(/does not belong to this club/);
    expect(await dateOf()).toBe('2026-10-25');
  });
});
