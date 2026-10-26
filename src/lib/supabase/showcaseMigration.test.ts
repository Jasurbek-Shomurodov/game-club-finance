import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(resolve('migrations', '098_public_showcase.sql'), 'utf8');
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const owner = '20000000-0000-0000-0000-000000000001';
let db: PGlite;

async function asRole(role: 'anon' | 'authenticated', actor = '', clubRole = 'owner') {
  await db.exec(`reset role;
    select set_config('test.actor','${actor}',false);
    select set_config('test.role','${clubRole}',false);
    set role ${role};`);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true),'')::uuid $$;
    create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create table public.clubs(id uuid primary key, name text not null, address text, is_active boolean not null default true);
    insert into public.clubs values ('${club}','Neon Arena','Tashkent',true),('${otherClub}','Other',null,true);
    create function public.current_user_club_role(id uuid) returns text language sql as $$
      select case when id='${club}' and auth.uid()='${owner}' then current_setting('test.role',true) end $$;
    grant usage on schema public, auth to authenticated, anon;
  `);
  await db.exec(migration);
}, 20000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`reset role; truncate club_showcases, showcase_games, showcase_pc_zones;
    insert into club_showcases(club_id, slug, is_published, tagline) values ('${club}','neon-arena',true,'Play');
    insert into showcase_games(club_id, title, sort_order) values ('${club}','Dota 2',20),('${club}','CS2',10);
    insert into showcase_pc_zones(club_id, name, pc_count, gpu, price_per_hour) values ('${club}','VIP',5,'RTX 4080',25000);`);
});

describe('098 public showcase', () => {
  it('re-runs cleanly', async () => {
    await db.exec(migration);
  });

  it('returns a published showcase to anonymous visitors in sort order', async () => {
    await asRole('anon');
    const { rows } = await db.query<{ page: { club_name: string; address: string; games: Array<{ title: string }>; zones: Array<{ gpu: string }> } }>(
      "select public.get_public_showcase(' Neon-Arena ') as page");
    expect(rows[0].page.club_name).toBe('Neon Arena');
    expect(rows[0].page.address).toBe('Tashkent');
    expect(rows[0].page.games.map((game) => game.title)).toEqual(['CS2', 'Dota 2']);
    expect(rows[0].page.zones[0].gpu).toBe('RTX 4080');
  });

  it('hides unpublished pages and inactive clubs', async () => {
    await db.exec(`update club_showcases set is_published = false`);
    await asRole('anon');
    expect((await db.query<{ page: unknown }>("select public.get_public_showcase('neon-arena') as page")).rows[0].page).toBeNull();
    await db.exec(`reset role; update club_showcases set is_published = true; update clubs set is_active = false where id = '${club}'`);
    await asRole('anon');
    expect((await db.query<{ page: unknown }>("select public.get_public_showcase('neon-arena') as page")).rows[0].page).toBeNull();
    await db.exec(`reset role; update clubs set is_active = true`);
  });

  it('gives anonymous visitors no direct table access', async () => {
    await asRole('anon');
    await expect(db.query('select * from showcase_games')).rejects.toThrow(/permission denied/);
  });

  it('lets only an owner of the club read and write', async () => {
    await asRole('authenticated', owner, 'admin');
    expect((await db.query('select * from showcase_games')).rows).toHaveLength(0);
    await expect(db.query(`insert into showcase_games(club_id, title) values ('${club}','X')`)).rejects.toThrow(/row-level security/);

    await asRole('authenticated', owner, 'owner');
    expect((await db.query('select * from showcase_games')).rows).toHaveLength(2);
    await db.query(`insert into showcase_games(club_id, title) values ('${club}','Valorant')`);
    await expect(db.query(`insert into showcase_games(club_id, title) values ('${otherClub}','X')`)).rejects.toThrow(/row-level security/);
  });

  it('enforces slug format and uniqueness', async () => {
    await expect(db.query(`insert into club_showcases(club_id, slug) values ('${otherClub}','Bad Slug')`)).rejects.toThrow(/slug_format/);
    await expect(db.query(`insert into club_showcases(club_id, slug) values ('${otherClub}','neon-arena')`)).rejects.toThrow(/slug_key/);
  });
});
