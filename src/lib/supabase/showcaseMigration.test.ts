import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(resolve('migrations', '098_public_showcase.sql'), 'utf8');
const brandMigration = readFileSync(resolve('migrations', '099_showcase_brands.sql'), 'utf8');
const specsMigration = readFileSync(resolve('migrations', '100_showcase_zone_specs.sql'), 'utf8');
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const thirdClub = '10000000-0000-0000-0000-000000000003';
const owner = '20000000-0000-0000-0000-000000000001';
const stranger = '20000000-0000-0000-0000-000000000002';
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
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${stranger}');
    create table public.clubs(id uuid primary key, name text not null, address text, is_active boolean not null default true,
      created_at timestamptz not null default now());
    insert into public.clubs(id,name,address,is_active,created_at) values
      ('${club}','Neon Arena','Tashkent',true,'2026-01-01'),('${otherClub}','Other',null,true,'2026-01-02'),
      ('${thirdClub}','Second Arena','Samarkand',true,'2026-01-03');
    create table public.club_memberships(club_id uuid, user_id uuid, role text);
    insert into public.club_memberships values ('${club}','${owner}','owner'),('${thirdClub}','${owner}','owner'),('${otherClub}','${stranger}','owner');
    create function public.current_user_club_role(id uuid) returns text language sql as $$
      select case when id='${club}' and auth.uid()='${owner}' then current_setting('test.role',true) end $$;
    grant usage on schema public, auth to authenticated, anon;
  `);
  await db.exec(migration);
  await db.exec(brandMigration);
  await db.exec(specsMigration);
}, 20000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`reset role; truncate club_showcases, showcase_games, showcase_pc_zones, showcase_brands;
    insert into club_showcases(club_id, slug, is_published, tagline) values ('${club}','neon-arena',true,'Play');
    insert into showcase_games(club_id, title, sort_order) values ('${club}','Dota 2',20),('${club}','CS2',10);
    insert into showcase_pc_zones(club_id, name, pc_count, gpu, price_per_hour) values ('${club}','VIP',5,'RTX 4080',25000);`);
});

describe('098 public showcase', () => {
  it('re-runs cleanly', async () => {
    await db.exec(migration);
    await db.exec(brandMigration);
    await db.exec(specsMigration);
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

  it('lists only the brand owner\'s published clubs on the brand page', async () => {
    await db.exec(`insert into club_showcases(club_id, slug, is_published) values
        ('${otherClub}','other-club',true),('${thirdClub}','second-arena',false);
      insert into showcase_brands(owner_id, slug, name, is_published) values ('${owner}','pixel-gaming','Pixel Gaming',true);`);
    await asRole('anon');
    const brand = async () => (await db.query<{ page: { name: string; clubs: Array<{ slug: string }> } | null }>(
      "select public.get_public_brand('pixel-gaming') as page")).rows[0].page;
    expect((await brand())?.clubs.map((item) => item.slug)).toEqual(['neon-arena']);

    await db.exec(`reset role; update club_showcases set is_published = true where club_id = '${thirdClub}'`);
    await asRole('anon');
    expect((await brand())?.clubs.map((item) => item.slug)).toEqual(['neon-arena', 'second-arena']);

    await db.exec(`reset role; update showcase_brands set is_published = false`);
    await asRole('anon');
    expect(await brand()).toBeNull();
  });

  it('lets each user manage only their own brand', async () => {
    await asRole('authenticated', owner);
    await db.query(`insert into showcase_brands(owner_id, slug, name) values ('${owner}','pixel-gaming','Pixel Gaming')`);
    await asRole('authenticated', stranger);
    expect((await db.query('select * from showcase_brands')).rows).toHaveLength(0);
    await expect(db.query(`insert into showcase_brands(owner_id, slug, name) values ('${owner}','stolen','X')`)).rejects.toThrow(/row-level security/);
    await asRole('anon');
    await expect(db.query('select public.public_showcase_payload($1)', [club])).rejects.toThrow(/permission denied/);
  });

  it('publishes the structured zone specs and checks their ranges', async () => {
    await db.exec(`update showcase_pc_zones set monitor_size_inches = 27, monitor_refresh_hz = 240, mouse = 'G Pro', keyboard = 'Apex Pro'`);
    await asRole('anon');
    const { rows } = await db.query<{ zone: Record<string, unknown> }>("select public.get_public_showcase('neon-arena')->'zones'->0 as zone");
    expect(rows[0].zone).toMatchObject({ monitor_size_inches: 27, monitor_refresh_hz: 240, mouse: 'G Pro', keyboard: 'Apex Pro', headset: null });
    await db.exec('reset role');
    await expect(db.query('update showcase_pc_zones set monitor_refresh_hz = 5')).rejects.toThrow(/monitor_refresh_range/);
    await expect(db.query('update showcase_pc_zones set monitor_size_inches = 500')).rejects.toThrow(/monitor_size_range/);
  });
});
