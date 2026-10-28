import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const migration = readFileSync(resolve('migrations', '112_google_business_profile.sql'), 'utf8');

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create table public.clubs (id uuid primary key);
    insert into public.clubs values ('${CLUB}');
  `);
  await db.exec(migration);
  // Re-runnable like the rest of the chain.
  await db.exec(migration);
});

afterAll(async () => {
  await db.close();
});

describe('112 Google Business Profile connections', () => {
  it('is reachable only by the service role', async () => {
    const { rows } = await db.query<{ role: string; readable: boolean; writable: boolean }>(`
      select role,
        has_table_privilege(role, 'public.google_business_connections', 'select') as readable,
        has_table_privilege(role, 'public.google_business_connections', 'insert') as writable
      from unnest(array['anon','authenticated','service_role']) as role order by role`);
    expect(rows).toEqual([
      { role: 'anon', readable: false, writable: false },
      { role: 'authenticated', readable: false, writable: false },
      { role: 'service_role', readable: true, writable: true },
    ]);
  });

  it('accepts only Google resource names and needs the account with a location', async () => {
    const insert = (account: string | null, location: string | null) => db.query(
      `insert into public.google_business_connections (club_id, refresh_token_encrypted, account_name, location_name)
       values ($1, 'v1.x.y.z', $2, $3)
       on conflict (club_id) do update set account_name = excluded.account_name, location_name = excluded.location_name`,
      [CLUB, account, location],
    );
    await expect(insert(null, null)).resolves.toBeDefined();
    await expect(insert('accounts/123', 'locations/456')).resolves.toBeDefined();
    await expect(insert('accounts/123', '../locations/456')).rejects.toThrow(/location_name_format/);
    await expect(insert('accounts/x', null)).rejects.toThrow(/account_name_format/);
    await expect(insert(null, 'locations/456')).rejects.toThrow(/location_needs_account/);
  });

  it('goes away with its club', async () => {
    await db.exec(`delete from public.clubs where id = '${CLUB}'`);
    const { rows } = await db.query('select 1 from public.google_business_connections');
    expect(rows).toEqual([]);
  });
});
