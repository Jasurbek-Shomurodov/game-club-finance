import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'migrations/096_daily_cash_collections.sql'), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const collector = '00000000-0000-0000-0000-000000000002';
const admin = '00000000-0000-0000-0000-000000000003';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
let db: PGlite;

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

const mark = (userId: string, date: string, clubId = club) => asUser(userId, async () => (await db.query<{ created: boolean }>(
  'select public.mark_daily_cash_collected($1, $2) as created', [clubId, date],
)).rows[0].created);
const unmark = (userId: string, date: string) => asUser(userId, () => db.query(
  'select public.unmark_daily_cash_collected($1, $2)', [club, date],
));
const ticked = (userId: string) => asUser(userId, async () => (await db.query<{ date: string; collected_by: string }>(
  "select to_char(date, 'YYYY-MM-DD') as date, collected_by from public.daily_cash_collections order by date",
)).rows);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth; grant usage on schema public, auth to authenticated;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${owner}'),('${collector}'),('${admin}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.clubs (id uuid primary key);
    insert into public.clubs values ('${club}'),('${otherClub}');
    create table public.club_memberships (club_id uuid, user_id uuid, role text, feature_access text[]);
    insert into public.club_memberships values
      ('${club}','${owner}','owner',null),
      ('${club}','${collector}','admin',array['reports','collection']),
      ('${club}','${admin}','admin',array['reports']);
    create function public.current_user_club_role(p_club_id uuid) returns text language sql stable security definer set search_path=public as $$
      select role from public.club_memberships where club_id=p_club_id and user_id=auth.uid()
    $$;
    create function public.current_user_can_access_club_feature(p_club_id uuid, p_feature_key text) returns boolean language sql stable security definer set search_path=public as $$
      select coalesce((select role = 'owner' or p_feature_key = any(coalesce(feature_access, '{}'))
        from public.club_memberships where club_id=p_club_id and user_id=auth.uid()), false)
    $$;
    create function public.current_user_readable_clubs(p_feature_keys text[]) returns setof uuid language sql stable security definer set search_path=public as $$
      select club_id from public.club_memberships m where m.user_id = auth.uid()
        and exists (select 1 from unnest(p_feature_keys) k where public.current_user_can_access_club_feature(m.club_id, k))
    $$;
    create function public.club_business_date(p_club_id uuid, p_at timestamptz default now()) returns date language sql stable as $$ select date '2026-10-25' $$;
  `);
  for (const sql of [migration, migration]) await db.exec(sql);
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('daily cash collections (096)', () => {
  it('lets a collector tick a date once, and keeps the first tick', async () => {
    expect(await mark(collector, '2026-10-24')).toBe(true);
    expect(await mark(collector, '2026-10-24')).toBe(false);
    expect(await mark(owner, '2026-10-24')).toBe(false);
    expect(await ticked(collector)).toEqual([{ date: '2026-10-24', collected_by: collector }]);
  });

  it('refuses members without the collection feature, other clubs and future dates', async () => {
    await expect(mark(admin, '2026-10-23')).rejects.toThrow(/Collection access/);
    await expect(mark(collector, '2026-10-23', otherClub)).rejects.toThrow(/Collection access/);
    await expect(mark(collector, '2026-10-26')).rejects.toThrow(/Invalid collection date/);
  });

  it('only lets an owner undo a tick', async () => {
    await expect(unmark(collector, '2026-10-24')).rejects.toThrow(/Only a club owner/);
    await expect(asUser(collector, () => db.query(`delete from public.daily_cash_collections where club_id = '${club}'`)))
      .rejects.toThrow(/permission denied/);
    expect(await ticked(admin)).toHaveLength(1);
    await unmark(owner, '2026-10-24');
    expect(await ticked(owner)).toEqual([]);
  });
});
