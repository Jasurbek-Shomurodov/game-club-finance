import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase, readMigration } from './__tests__/snapshotDatabase';

/** Migration 187 on the full replayed schema: the owner's real PC counts, 95 at Algoritm and 55 at Matbuotchilar 17. */

const counts = readMigration('187_pixel_real_pc_counts.sql');
const algoritm = '8390a015-5f28-4f78-a5a2-302dd61852a7';
const pixel = '7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305';
const algoritmStandard = '59c4c98a-658e-4243-ab0f-ac7ae4627a03';
const pixelStandard = '2a92b37a-3991-49b2-81db-7c37ef95af81';

// The taglines as 174 and 179 left them in production.
const algoritmTagline = {
  ru: 'Компьютерный клуб Pixel Gaming (Algoritm) в Чиланзаре: 82 игровых ПК, VIP-зона на 15 мест и PlayStation 5. CS2, Dota 2 и все популярные игры, напитки и снеки. Работаем 24/7.',
  uz: 'Chilonzordagi Pixel Gaming (Algoritm) kompyuter klubi: 82 ta o‘yin kompyuteri, 15 o‘rinli VIP zona va PlayStation 5. CS2, Dota 2 va barcha mashhur o‘yinlar, ichimlik va sneklar. 24/7 ishlaymiz.',
  en: 'Pixel Gaming (Algoritm) gaming club in Chilanzar, Tashkent: 82 gaming PCs, a 15-seat VIP zone and PlayStation 5. CS2, Dota 2 and every popular title, drinks and snacks. Open 24/7.',
};
const pixelTagline = {
  ru: 'Компьютерный клуб Pixel Gaming у площади Амира Темура (Матбуотчилар, 17): 43 мощных игровых ПК, VIP-кабинки, PlayStation 5, быстрые мониторы и все популярные игры. Работаем 24/7.',
  uz: 'Amir Temur xiyoboni yonidagi Pixel Gaming kompyuter klubi (Matbuotchilar, 17): 43 ta kuchli o‘yin kompyuteri, VIP kabinalar, PlayStation 5, tezkor monitorlar va barcha mashhur o‘yinlar. 24/7 ishlaymiz.',
  en: 'Pixel Gaming club by Amir Temur Square (Matbuotchilar 17), Tashkent: 43 powerful gaming PCs, private VIP rooms, PlayStation 5, fast monitors and every popular title. Open 24/7.',
};
const literal = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const text = (value: string) => `'${value.replace(/'/g, "''")}'`;
let db: PGlite;

beforeAll(async () => {
  // 187 runs here too, on a database without the clubs.
  db = await fullSchemaDatabase();
}, 120_000);

afterAll(async () => { await db?.close(); });

/** Each case starts from the rows as production holds them and leaves nothing behind. */
async function asInProduction(work: () => Promise<void>) {
  await db.exec('begin');
  try {
    await db.exec(`
      insert into public.clubs (id, name) values ('${algoritm}', 'Pixel Gaming (Algoritm)'), ('${pixel}', 'Pixel Gaming');
      insert into public.club_showcases (club_id, slug, is_published, tagline, translations) values
        ('${algoritm}', 'main-game-club', true, ${text(algoritmTagline.ru)}, jsonb_build_object('tagline', ${literal(algoritmTagline)}, 'branch', '{"en":"Chilanzar"}'::jsonb)),
        ('${pixel}', 'pixel-game-club', true, ${text(pixelTagline.ru)}, jsonb_build_object('tagline', ${literal(pixelTagline)}));
      insert into public.showcase_pc_zones (id, club_id, kind, name, translations, pc_count, price_per_hour, sort_order) values
        ('${algoritmStandard}', '${algoritm}', 'pc', 'Стандарт', '{"name":{"ru":"Стандарт","uz":"Standart","en":"Standard"}}', 82, 10000, 10),
        (gen_random_uuid(), '${algoritm}', 'pc', 'VIP', '{"name":{"ru":"VIP","uz":"VIP","en":"VIP"}}', 15, 13000, 20),
        (gen_random_uuid(), '${algoritm}', 'playstation', 'PlayStation 5', '{}', 2, 40000, 30),
        ('${pixelStandard}', '${pixel}', 'pc', 'Стандарт', '{"name":{"ru":"Стандарт","uz":"Standart","en":"Standard"}}', 33, 15000, 10),
        (gen_random_uuid(), '${pixel}', 'pc', 'VIP', '{"name":{"ru":"VIP","uz":"VIP","en":"VIP"}}', 10, 25000, 20),
        (gen_random_uuid(), '${pixel}', 'playstation', 'PlayStation 5', '{}', 2, 40000, 30);
    `);
    await work();
  } finally {
    await db.exec('rollback');
  }
}

const pcTotal = async (club: string) => Number((await db.query<{ total: string }>(
  `select coalesce(sum(pc_count), 0) as total from public.showcase_pc_zones where club_id = '${club}' and kind = 'pc'`,
)).rows[0].total);
const showcase = async (club: string) => (await db.query<{ tagline: string; translations: Record<string, Record<string, string>> }>(
  `select tagline, translations from public.club_showcases where club_id = '${club}'`,
)).rows[0];
const zones = async (club: string) => (await db.query<{ name: string; kind: string; pc_count: number; price_per_hour: string | null; sort_order: number; translations: unknown; cpu: string | null; gpu: string | null; image_url: string | null }>(
  `select name, kind, pc_count, price_per_hour, sort_order, translations, cpu, gpu, image_url from public.showcase_pc_zones where club_id = '${club}' order by sort_order`,
)).rows;

describe('187 the real PC counts', () => {
  it('counts 95 computers at Algoritm and 55 at Matbuotchilar 17', async () => {
    await asInProduction(async () => {
      expect(await pcTotal(algoritm)).toBe(97);
      expect(await pcTotal(pixel)).toBe(43);
      await db.exec(counts);
      expect(await pcTotal(algoritm)).toBe(95);
      expect(await pcTotal(pixel)).toBe(55);
      expect((await zones(algoritm)).map((zone) => [zone.name, zone.pc_count])).toEqual([['Стандарт', 80], ['VIP', 15], ['PlayStation 5', 2]]);
      expect((await zones(pixel)).map((zone) => [zone.name, zone.pc_count])).toEqual([['Стандарт', 35], ['VIP', 10], ['Pro', 10], ['PlayStation 5', 2]]);
    });
  });

  it('adds a Pro zone between VIP and PlayStation with no hardware invented', async () => {
    await asInProduction(async () => {
      await db.exec(counts);
      const rows = await zones(pixel);
      expect(rows.map((zone) => zone.name)).toEqual(['Стандарт', 'VIP', 'Pro', 'PlayStation 5']);
      const pro = rows.find((zone) => zone.name === 'Pro')!;
      expect(pro).toMatchObject({ kind: 'pc', pc_count: 10, sort_order: 25, cpu: null, gpu: null, image_url: null });
      expect(Number(pro.price_per_hour)).toBe(20000);
      expect(pro.translations).toEqual({ name: { ru: 'Pro', uz: 'Pro', en: 'Pro' } });
    });
  });

  it('changes only the number in each tagline and keeps the other translations', async () => {
    await asInProduction(async () => {
      await db.exec(counts);
      const main = await showcase(algoritm);
      expect(main.tagline).toBe(algoritmTagline.ru.replace('82 игровых', '95 игровых'));
      expect(main.translations.tagline).toEqual({
        ru: algoritmTagline.ru.replace('82 игровых', '95 игровых'),
        uz: algoritmTagline.uz.replace('82 ta', '95 ta'),
        en: algoritmTagline.en.replace('82 gaming', '95 gaming'),
      });
      expect(main.translations.branch).toEqual({ en: 'Chilanzar' });
      expect(main.translations.tagline.ru).toContain('VIP-зона на 15 мест');
      const square = await showcase(pixel);
      expect(square.tagline).toBe(pixelTagline.ru.replace('43', '55'));
      expect(square.translations.tagline).toEqual({
        ru: pixelTagline.ru.replace('43', '55'),
        uz: pixelTagline.uz.replace('43', '55'),
        en: pixelTagline.en.replace('43', '55'),
      });
    });
  });

  it('re-runs without a second Pro zone or further changes', async () => {
    await asInProduction(async () => {
      await db.exec(counts);
      const before = [await zones(algoritm), await zones(pixel), await showcase(algoritm), await showcase(pixel)];
      await db.exec(counts);
      expect([await zones(algoritm), await zones(pixel), await showcase(algoritm), await showcase(pixel)]).toEqual(before);
      expect(await pcTotal(pixel)).toBe(55);
    });
  });

  it('leaves alone what the owner has since edited', async () => {
    await asInProduction(async () => {
      await db.exec(`
        update public.showcase_pc_zones set pc_count = 81 where id = '${algoritmStandard}';
        update public.showcase_pc_zones set pc_count = 11 where club_id = '${pixel}' and name = 'VIP';
        update public.club_showcases set tagline = 'Свой текст', translations = translations || jsonb_build_object('tagline', jsonb_build_object('en', 'Own text'))
          where club_id = '${pixel}';
      `);
      await db.exec(counts);
      expect(await pcTotal(algoritm)).toBe(96);
      expect((await zones(pixel)).some((zone) => zone.name === 'Pro')).toBe(false);
      const square = await showcase(pixel);
      expect(square.tagline).toBe('Свой текст');
      expect(square.translations.tagline).toEqual({ en: 'Own text' });
    });
  });

  it('does not add a language a tagline did not have', async () => {
    await asInProduction(async () => {
      await db.exec(`update public.club_showcases set translations = jsonb_build_object('tagline', jsonb_build_object('en', ${text(algoritmTagline.en)}))
        where club_id = '${algoritm}'`);
      await db.exec(counts);
      expect((await showcase(algoritm)).translations.tagline).toEqual({ en: algoritmTagline.en.replace('82 gaming', '95 gaming') });
    });
  });

  it('adds the Pro zone when Standard was already moved to 35, and never twice', async () => {
    await asInProduction(async () => {
      await db.exec(`update public.showcase_pc_zones set pc_count = 35 where id = '${pixelStandard}'`);
      await db.exec(counts);
      expect(await pcTotal(pixel)).toBe(55);
      await db.exec(counts);
      expect((await zones(pixel)).filter((zone) => zone.name === 'Pro')).toHaveLength(1);
      expect(await pcTotal(pixel)).toBe(55);
    });
  });

  it('adds no Pro zone and leaves Standard alone when the owner has changed them', async () => {
    await asInProduction(async () => {
      await db.exec(`update public.showcase_pc_zones set pc_count = 34 where id = '${pixelStandard}'`);
      await db.exec(counts);
      const rows = await zones(pixel);
      expect(rows.find((zone) => zone.name === 'Стандарт')?.pc_count).toBe(34);
      expect(rows.some((zone) => zone.name === 'Pro')).toBe(false);
    });
  });

  it('leaves an existing Pro zone alone', async () => {
    await asInProduction(async () => {
      await db.exec(`update public.showcase_pc_zones set name = 'PRO', pc_count = 10 where club_id = '${pixel}' and name = 'VIP'`);
      await db.exec(counts);
      expect((await zones(pixel)).filter((zone) => zone.name.toLowerCase() === 'pro')).toHaveLength(1);
    });
  });
});
