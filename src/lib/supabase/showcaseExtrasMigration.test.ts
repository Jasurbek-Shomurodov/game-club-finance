import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyDatabase } from './__tests__/snapshotDatabase';

const sql = (file: string) => readFileSync(resolve('migrations', file), 'utf8');
// The showcase chain up to the payload this migration replaces (140).
const chain = [
  '098_public_showcase.sql', '099_showcase_brands.sql', '100_showcase_zone_specs.sql', '101_showcase_translations.sql',
  '102_showcase_offers.sql', '104_showcase_contacts_and_consoles.sql', '105_showcase_club_order.sql',
  '106_showcase_zone_translations.sql', '140_showcase_yandex_maps_url.sql',
].map(sql);
const migration = sql('178_showcase_gallery_amenities_rating.sql');

const club = '10000000-0000-0000-0000-000000000001';
const pixel = '10000000-0000-0000-0000-000000000002';
const owner = '20000000-0000-0000-0000-000000000001';
let db: PGlite;

const payload = async (slug: string) => (await db.query<{ data: Record<string, unknown> | null }>(`select get_public_showcase('${slug}') as data`)).rows[0].data;

beforeAll(async () => {
  db = await emptyDatabase();
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true),'')::uuid $$;
    create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}');
    create table public.clubs(id uuid primary key, name text not null, address text, logo_url text, is_active boolean not null default true,
      created_at timestamptz not null default now());
    insert into public.clubs(id,name,address) values ('${club}','Neon Arena','Tashkent'), ('${pixel}','Pixel Gaming','Matbuotchilar 17');
    create table public.club_memberships(club_id uuid, user_id uuid, role text);
    insert into public.club_memberships values ('${club}','${owner}','owner');
    create function public.current_user_club_role(id uuid) returns text language sql as $$
      select role from public.club_memberships where club_id = id and user_id = auth.uid() $$;
    create function public.current_user_can_access_club_feature(id uuid, feature text) returns boolean language sql as $$
      select coalesce(public.current_user_club_role(id) = 'owner', false) $$;
    create table public.google_review_digests(club_id uuid not null, digest_date date not null, average_rating numeric(3,2),
      total_review_count integer, primary key (club_id, digest_date));
    revoke all on table public.google_review_digests from public, anon, authenticated;
    grant usage on schema public, auth to authenticated, anon;
  `);
  for (const file of chain) await db.exec(file);
  await db.exec(`insert into club_showcases(club_id, slug, is_published) values ('${pixel}','pixel-game-club',true)`);
  await db.exec(migration);
}, 30000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`reset role; delete from google_review_digests; delete from club_showcases where club_id = '${club}';
    insert into club_showcases(club_id, slug, is_published) values ('${club}','neon-arena',true);`);
});

describe('178 showcase gallery, amenities and rating', () => {
  it('re-runs cleanly and keeps what an owner has since edited', async () => {
    await db.exec(`update club_showcases set amenities = array['wifi'] where slug = 'pixel-game-club'`);
    await db.exec(migration);
    const page = await payload('pixel-game-club');
    expect(page?.amenities).toEqual(['wifi']);
  });

  it('gives a Pixel branch its name, landmark, address and amenities once', async () => {
    const page = await payload('pixel-game-club');
    const translations = page?.translations as Record<string, Record<string, string>>;
    expect(translations.branch.en).toBe('Amir Temur');
    expect(translations.landmark.uz).toContain('Zarafshon');
    expect(translations.address.ru).toBe('Ташкент, ул. Матбуотчилар, 17');
  });

  it('publishes amenities, photos and the Google Maps place', async () => {
    await db.exec(`update club_showcases set amenities = array['wifi','parking'], gallery = array['https://cdn.example/a.jpg'],
      google_maps_url = 'https://maps.app.goo.gl/AbC' where club_id = '${club}'`);
    await db.exec('set role anon');
    const page = await payload('neon-arena');
    expect(page).toMatchObject({ amenities: ['wifi', 'parking'], gallery: ['https://cdn.example/a.jpg'], google_maps_url: 'https://maps.app.goo.gl/AbC' });
    expect(page?.google_rating).toBeNull();
  });

  it('publishes the latest recorded Google rating, and only that from the digests', async () => {
    await db.exec(`insert into google_review_digests values
      ('${club}','2026-11-21',4.50,7), ('${club}','2026-11-22',4.80,9), ('${club}','2026-11-23',null,null)`);
    await db.exec('set role anon');
    const page = await payload('neon-arena');
    expect(Number(page?.google_rating)).toBe(4.8);
    expect(page?.google_review_count).toBe(9);
    await expect(db.query('select * from google_review_digests')).rejects.toThrow(/permission denied/);
  });

  it('refuses unknown amenities, a thirteenth photo and a link that is not Google Maps', async () => {
    const set = (assignment: string) => db.exec(`update club_showcases set ${assignment} where club_id = '${club}'`);
    await expect(set(`amenities = array['jacuzzi']`)).rejects.toThrow(/club_showcases_amenities_known/);
    await expect(set(`gallery = array(select 'https://cdn.example/' || n from generate_series(1, 13) n)`)).rejects.toThrow(/club_showcases_gallery_size/);
    await expect(set(`google_maps_url = 'https://google.evil.example/maps'`)).rejects.toThrow(/club_showcases_google_maps_url/);
    await set(`google_maps_url = 'https://www.google.com/maps/place/Neon'`);
  });
});
