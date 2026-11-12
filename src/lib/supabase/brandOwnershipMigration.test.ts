import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const sql = (file: string) => readFileSync(resolve('migrations', file), 'utf8');
const migration = sql('117_brand_owner_only_and_payload_cleanup.sql');

const club = '10000000-0000-0000-0000-000000000001';
const owner = '20000000-0000-0000-0000-000000000001';
const signUp = '20000000-0000-0000-0000-000000000002';
const exOwner = '20000000-0000-0000-0000-000000000003';
let db: PGlite;

async function actAs(role: 'anon' | 'authenticated', actor = '') {
  await db.exec(`reset role; select set_config('test.actor','${actor}',false); set role ${role};`);
}

const brandSql = (actor: string, slug: string, published = true) => `
  insert into showcase_brands(owner_id, slug, name, is_published) values ('${actor}','${slug}','Brand',${published})`;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true),'')::uuid $$;
    create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${signUp}'),('${exOwner}');
    create table public.clubs(id uuid primary key, name text not null, address text, is_active boolean not null default true,
      created_at timestamptz not null default now());
    insert into public.clubs(id,name) values ('${club}','Neon Arena');
    create table public.club_memberships(club_id uuid, user_id uuid, role text);
    insert into public.club_memberships values ('${club}','${owner}','owner');
    create function public.current_user_club_role(id uuid) returns text language sql as $$
      select role from public.club_memberships where club_id = id and user_id = auth.uid() $$;
    create function public.current_user_can_access_club_feature(id uuid, feature text) returns boolean language sql as $$
      select coalesce(public.current_user_club_role(id) = 'owner', false) $$;
    create function public.current_user_owns_any_club() returns boolean language sql security definer as $$
      select exists (select 1 from public.club_memberships where user_id = auth.uid() and role = 'owner') $$;
    grant usage on schema public, auth to authenticated, anon;
    grant execute on function public.current_user_owns_any_club() to authenticated;
    grant select on public.club_memberships to authenticated;
  `);
  for (const file of [
    '098_public_showcase.sql', '099_showcase_brands.sql', '100_showcase_zone_specs.sql', '101_showcase_translations.sql',
    '102_showcase_offers.sql', '104_showcase_contacts_and_consoles.sql', '105_showcase_club_order.sql',
    '106_showcase_zone_translations.sql', '107_club_logos.sql', '116_brand_telegram_links.sql',
  ]) await db.exec(sql(file));
}, 20000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`reset role; truncate showcase_brands, club_showcases, showcase_pc_zones;
    ${brandSql(exOwner, 'old-brand')};
    ${brandSql(owner, 'pixel-gaming')};
    insert into club_showcases(club_id, slug, is_published) values ('${club}','neon-arena',true);
    insert into showcase_pc_zones(club_id, name, pc_count, gpu, storage) values ('${club}','VIP',5,'RTX 4080','2 TB SSD');`);
  await db.exec(migration);
});

describe('117 brand pages need a club owner', () => {
  it('re-runs cleanly', async () => {
    await db.exec(migration);
  });

  it('refuses a brand from an account that owns no club', async () => {
    await actAs('authenticated', signUp);
    await expect(db.exec(brandSql(signUp, 'fake-pixel'))).rejects.toThrow(/row-level security/);
    await db.exec('reset role');
  });

  it('lets a club owner save their own brand, and nobody else\'s', async () => {
    await actAs('authenticated', owner);
    await db.exec(`update showcase_brands set name = 'Pixel' where owner_id = '${owner}'`);
    await expect(db.exec(`update showcase_brands set owner_id = '${signUp}' where owner_id = '${owner}'`)).rejects.toThrow(/row-level security/);
    const hidden = await db.query(`update showcase_brands set name = 'Taken' where owner_id = '${exOwner}' returning owner_id`);
    expect(hidden.rows).toEqual([]);
    expect((await db.query<{ name: string }>('select name from showcase_brands')).rows).toEqual([{ name: 'Pixel' }]);
    await db.exec('reset role');
  });

  it('keeps read and delete of the own row after losing ownership, but not update', async () => {
    await actAs('authenticated', exOwner);
    expect((await db.query('select slug from showcase_brands')).rows).toEqual([{ slug: 'old-brand' }]);
    await expect(db.exec(`update showcase_brands set is_published = true where owner_id = '${exOwner}'`)).rejects.toThrow(/row-level security/);
    await db.exec(`delete from showcase_brands where owner_id = '${exOwner}'`);
    await db.exec('reset role');
    expect((await db.query('select 1 from showcase_brands where slug = \'old-brand\'')).rows).toEqual([]);
  });

  it('unpublishes brands without a club owner and deletes nothing', async () => {
    const { rows } = await db.query<{ slug: string; is_published: boolean }>('select slug, is_published from showcase_brands order by slug');
    expect(rows).toEqual([{ slug: 'old-brand', is_published: false }, { slug: 'pixel-gaming', is_published: true }]);
    await actAs('anon');
    expect((await db.query<{ page: unknown }>("select public.get_public_brand('old-brand') as page")).rows[0].page).toBeNull();
    await db.exec('reset role');
  });
});

describe('117 anonymous payload', () => {
  it('no longer carries storage and keeps the other specs', async () => {
    await actAs('anon');
    const zones = (await db.query<{ z: Array<Record<string, unknown>> }>("select public.get_public_showcase('neon-arena')->'zones' as z")).rows[0].z;
    expect(zones[0]).toMatchObject({ name: 'VIP', gpu: 'RTX 4080' });
    expect(zones[0]).not.toHaveProperty('storage');
    await db.exec('reset role');
  });

  it('stays closed to direct anonymous calls', async () => {
    await actAs('anon');
    await expect(db.query(`select public.public_showcase_payload('${club}')`)).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
});

describe('140 club Yandex Maps place', () => {
  const yandexMigration = sql('140_showcase_yandex_maps_url.sql');

  it('publishes the saved place, sets both Pixel branches and only accepts Yandex Maps links', async () => {
    await db.exec(yandexMigration);
    await db.exec(yandexMigration);
    await actAs('anon');
    const empty = (await db.query<{ p: Record<string, unknown> }>("select public.get_public_showcase('neon-arena') as p")).rows[0].p;
    expect(empty.yandex_maps_url).toBeNull();
    await db.exec(`reset role; update club_showcases set yandex_maps_url = 'https://yandex.uz/maps/org/neon/123/'`);
    await actAs('anon');
    const saved = (await db.query<{ p: Record<string, unknown> }>("select public.get_public_showcase('neon-arena') as p")).rows[0].p;
    expect(saved.yandex_maps_url).toBe('https://yandex.uz/maps/org/neon/123/');
    await db.exec('reset role');
    await expect(db.query(`update club_showcases set yandex_maps_url = 'https://evil.example/maps/'`)).rejects.toThrow(/yandex_maps_url/);
    await expect(db.query(`update club_showcases set yandex_maps_url = 'javascript:alert(1)'`)).rejects.toThrow(/yandex_maps_url/);
  });

  it('fills a Pixel branch that has no place yet and keeps one already saved', async () => {
    await db.exec(`update club_showcases set slug = 'main-game-club', yandex_maps_url = null`);
    await db.exec(yandexMigration);
    expect((await db.query<{ u: string }>('select yandex_maps_url as u from club_showcases')).rows[0].u)
      .toBe('https://yandex.uz/maps/org/pixel_gaming/76261965061/');
    await db.exec(`update club_showcases set yandex_maps_url = 'https://yandex.uz/maps/org/other/1/'`);
    await db.exec(yandexMigration);
    expect((await db.query<{ u: string }>('select yandex_maps_url as u from club_showcases')).rows[0].u)
      .toBe('https://yandex.uz/maps/org/other/1/');
  });
});
