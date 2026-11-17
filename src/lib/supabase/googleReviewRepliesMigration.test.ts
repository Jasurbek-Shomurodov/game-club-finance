import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const read = (file: string) => readFileSync(resolve('migrations', file), 'utf8');
const migration = read('152_google_review_auto_replies.sql');

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create schema vault; create schema extensions;
    create table public.clubs (id uuid primary key);
    insert into public.clubs values ('${CLUB}');
  `);
  await db.exec(read('112_google_business_profile.sql'));
  await db.exec(`insert into public.google_business_connections (club_id, refresh_token_encrypted) values ('${CLUB}', 'x')`);
  await db.exec(migration);
  // Re-runnable like the rest of the chain.
  await db.exec(migration);
});

afterAll(async () => {
  await db.close();
});

describe('152 Google review auto replies', () => {
  it('turns auto replies on for existing connections', async () => {
    const { rows } = await db.query<{ review_auto_reply: boolean }>('select review_auto_reply from public.google_business_connections');
    expect(rows).toEqual([{ review_auto_reply: true }]);
  });

  it('keeps the reply log away from browser roles', async () => {
    const { rows } = await db.query<{ role: string; readable: boolean }>(`
      select role, has_table_privilege(role, 'public.google_review_replies', 'select') as readable
      from unnest(array['anon','authenticated','service_role']) as role order by role`);
    expect(rows).toEqual([
      { role: 'anon', readable: false },
      { role: 'authenticated', readable: false },
      { role: 'service_role', readable: true },
    ]);
  });

  it('records one reply per review', async () => {
    const insert = `insert into public.google_review_replies (club_id, review_name, star_rating, reply_comment)
      values ('${CLUB}', 'accounts/1/locations/2/reviews/r1', 5, 'Rahmat!')`;
    await db.exec(insert);
    await expect(db.exec(insert)).rejects.toThrow();
    await expect(db.exec(`insert into public.google_review_replies (club_id, review_name, reply_comment)
      values ('${CLUB}', 'locations/2', 'x')`)).rejects.toThrow();
  });

  it('does not let browser roles run the cron invoker', async () => {
    const { rows } = await db.query<{ allowed: boolean }>(
      `select has_function_privilege('authenticated', 'public.invoke_game_club_google_review_replies()', 'execute') as allowed`);
    expect(rows).toEqual([{ allowed: false }]);
  });
});
