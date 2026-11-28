import { describe, expect, it } from 'vitest';
import { formatCurrency } from '@/lib/formatters';
import {
  buildYandexPriceItems,
  buildYandexYml,
  diffPriceList,
  formatPriceDiff,
  normalizePriceName,
  parsePriceSnapshot,
  priceNameWords,
  yandexPriceClubFromShowcase,
  snapshotPrice,
  yandexItemId,
  yandexItemName,
  type YandexPriceClub,
  type YandexPriceItem,
} from './priceList';

const ZONE_A = '11111111-2222-3333-4444-555555555555';
const ZONE_B = '66666666-7777-8888-9999-000000000000';

function club(overrides: Partial<YandexPriceClub> = {}): YandexPriceClub {
  return {
    logoUrl: 'https://cdn.example.com/logo.png',
    zones: [
      { id: ZONE_B, name: 'PlayStation', translations: undefined, price_per_hour: 30000, image_url: null, sort_order: 2 },
      { id: ZONE_A, name: 'VIP', translations: { name: { ru: 'VIP зал', uz: 'VIP zal' } }, price_per_hour: 25000, image_url: 'https://cdn.example.com/vip.jpg', sort_order: 1 },
    ],
    offers: [
      {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'VIP · 3 часа', description: 'Три часа', price: 60000, time_window: '10:00 - 18:00', is_active: true, sort_order: 1,
        translations: { title: { ru: 'VIP · 3 часа' }, description: { ru: 'Три часа днём.' } },
      },
      { id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Ночной пакет', description: null, price: 80000, time_window: null, is_active: true, sort_order: 2 },
      { id: 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Старая акция', description: null, price: 10000, time_window: null, is_active: false, sort_order: 3 },
      { id: 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Турнир', description: null, price: null, time_window: null, is_active: true, sort_order: 4 },
    ],
    ...overrides,
  };
}

describe('buildYandexPriceItems', () => {
  it('lists each zone as a category in zone order, its hour first, then combos', () => {
    const { items, skipped } = buildYandexPriceItems(club());
    expect(items.map((item) => [item.name, item.price, item.category.id, item.category.name])).toEqual([
      ['Игровой час — VIP зал', 25000, '1', 'VIP зал'],
      ['VIP — 3 часа (10:00–18:00)', 60000, '1', 'VIP зал'],
      ['Игровой час — PlayStation', 30000, '2', 'PlayStation'],
      ['Ночной пакет', 80000, '3', 'Комбо и акции'],
    ]);
    expect(items.map((item) => item.zoneId)).toEqual([ZONE_A, ZONE_A, ZONE_B, null]);
    expect(skipped).toEqual([{ kind: 'offer', id: 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Турнир', reason: 'no_price' }]);
  });

  it('prefers the Russian text and keeps the time window in the name only', () => {
    const offer = buildYandexPriceItems(club()).items[1];
    expect(offer.description).toBe('Три часа днём.');
    expect(buildYandexPriceItems(club()).items[3].description).toBeNull();
  });

  it('writes the app title separator as a dash', () => {
    expect(yandexItemName(' Стандарт · 1 час ')).toBe('Стандарт — 1 час');
    expect(yandexItemName('VIP | 2+1 часа')).toBe('VIP — 2+1 часа');
    expect(yandexItemName('Combo PS+PC')).toBe('Combo PS+PC');
  });

  it('keeps names unique: the time window first, then the price, then a number', () => {
    const offer = (id: string, price: number, time_window: string | null) => ({
      id: `${id}0000000-bbbb-cccc-dddd-eeeeeeeeeeee`, title: 'Стандарт · 1 час', description: null, price, time_window, is_active: true, sort_order: Number(id),
    });
    const names = (offers: YandexPriceClub['offers']) => buildYandexPriceItems(club({ zones: [], offers })).items.map((item) => item.name);
    expect(names([offer('1', 10000, '06:00–18:00'), offer('2', 15000, '18:00 – 06:00')])).toEqual([
      'Стандарт — 1 час (06:00–18:00)',
      'Стандарт — 1 час (18:00–06:00)',
    ]);
    expect(names([offer('1', 10000, null), offer('2', 15000, null)])).toEqual([
      `Стандарт — 1 час — ${formatCurrency(10000)} сум`,
      `Стандарт — 1 час — ${formatCurrency(15000)} сум`,
    ]);
    expect(names([offer('1', 10000, null), offer('2', 10000, null)])).toEqual([
      `Стандарт — 1 час — ${formatCurrency(10000)} сум`,
      `Стандарт — 1 час — ${formatCurrency(10000)} сум (2)`,
    ]);
  });

  it('leaves out a zone hour that an active 1-hour package already sells', () => {
    const hourPackage = { id: 'eeeeeeee-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'PlayStation · 1 час', description: null, price: 30000, time_window: null, is_active: true, sort_order: 0 };
    const { items, skipped } = buildYandexPriceItems(club({ offers: [hourPackage] }));
    expect(items.map((item) => item.name)).toEqual(['Игровой час — VIP зал', 'PlayStation — 1 час']);
    expect(items[1].category).toEqual({ id: '2', name: 'PlayStation' });
    expect(skipped).toEqual([{ kind: 'zone', id: ZONE_B, name: 'PlayStation', reason: 'hourly_offer' }]);
    const inactive = buildYandexPriceItems(club({ offers: [{ ...hourPackage, is_active: false }] }));
    expect(inactive.items.map((item) => item.name)).toContain('Игровой час — PlayStation');
    const threeHours = buildYandexPriceItems(club({ offers: [{ ...hourPackage, title: 'PlayStation · 3 часа' }] }));
    expect(threeHours.items.map((item) => item.name)).toContain('Игровой час — PlayStation');
  });

  it('uses the zone photo, else the club logo, else none', () => {
    const { items } = buildYandexPriceItems(club());
    expect(items[0].picture).toBe('https://cdn.example.com/vip.jpg');
    expect(items[1].picture).toBe('https://cdn.example.com/vip.jpg');
    expect(items[2].picture).toBe('https://cdn.example.com/logo.png');
    expect(items[3].picture).toBe('https://cdn.example.com/logo.png');
    expect(buildYandexPriceItems(club({ logoUrl: null })).items[3].picture).toBeNull();
  });

  it('writes what each price card shows', () => {
    const offers = [
      { id: '10000000-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'VIP · 2+1 hours', translations: { title: { ru: 'VIP · 2+1 часа' } }, description: null, price: 40000, time_window: '06:00 - 18:00', is_active: true, sort_order: 1 },
      { id: '20000000-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Комбо: 3+2 часа + сеты ZarKebab', description: null, price: 70000, time_window: null, is_active: true, sort_order: 2 },
      { id: '30000000-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Турнирный день', description: null, price: 5000, time_window: null, is_active: true, sort_order: 3 },
    ];
    const cards = buildYandexPriceItems(club({ offers })).items.map((entry) => entry.card);
    expect(cards).toEqual([
      { label: 'VIP зал', headline: '1 час', timeWindow: null },
      { label: 'VIP зал', headline: '2+1 часа', timeWindow: '06:00–18:00' },
      { label: 'PlayStation', headline: '1 час', timeWindow: null },
      { label: 'Комбо', headline: '3+2 часа + сеты ZarKebab', timeWindow: null },
      { label: 'Комбо и акции', headline: 'Турнирный день', timeWindow: null },
    ]);
  });

  it('gives offers of a zone the page does not list a category of their own, before combos', () => {
    const offers = [
      { id: '10000000-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Комбо: 7 часов + сет', description: null, price: 85000, time_window: null, is_active: true, sort_order: 1 },
      { id: '20000000-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Pro · 1 час', description: null, price: 20000, time_window: null, is_active: true, sort_order: 2 },
      { id: '30000000-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'pro · 7 часов', description: null, price: 100000, time_window: null, is_active: true, sort_order: 3 },
    ];
    const { items } = buildYandexPriceItems(club({ offers }));
    expect(items.map((entry) => [entry.name, entry.category.id, entry.category.name, entry.card.label, entry.card.headline])).toEqual([
      ['Игровой час — VIP зал', '1', 'VIP зал', 'VIP зал', '1 час'],
      ['Игровой час — PlayStation', '2', 'PlayStation', 'PlayStation', '1 час'],
      ['Pro — 1 час', '3', 'Pro', 'Pro', '1 час'],
      ['pro — 7 часов', '3', 'Pro', 'Pro', '7 часов'],
      ['Комбо: 7 часов + сет', '4', 'Комбо и акции', 'Комбо', '7 часов + сет'],
    ]);
  });

  it('keeps rows of equal sort order in the order given (created_at, as the public page and plan read them)', () => {
    const zones = [
      { id: 'zone-late', name: 'Pro', price_per_hour: 20000, image_url: null, sort_order: 10 },
      { id: 'zone-first', name: 'Стандарт', price_per_hour: 15000, image_url: null, sort_order: 10 },
      { id: 'zone-top', name: 'VIP', price_per_hour: 30000, image_url: null, sort_order: 5 },
    ];
    const { items } = buildYandexPriceItems(club({ zones, offers: [] }));
    expect(items.map((entry) => [entry.category.id, entry.category.name])).toEqual([['1', 'VIP'], ['2', 'Pro'], ['3', 'Стандарт']]);
  });

  it('points pictures at the price cards when asked', () => {
    const { items } = buildYandexPriceItems(club(), {
      cardPictures: { baseUrl: 'https://pixelgaming.uz/api/showcase/price-card/', slug: 'pixel-game-club', isCardImage: () => true },
    });
    for (const entry of items) {
      expect(entry.picture).toMatch(new RegExp(`^https://pixelgaming\\.uz/api/showcase/price-card/pixel-game-club/${entry.id}\\.png\\?v=[0-9a-f]{8}$`));
    }
    const again = buildYandexPriceItems(club(), { cardPictures: { baseUrl: 'https://pixelgaming.uz/api/showcase/price-card', slug: 'pixel-game-club', isCardImage: () => true } });
    expect(again.items.map((entry) => entry.picture)).toEqual(items.map((entry) => entry.picture));
  });

  it("writes the zone's hardware after each of its items' text, and only there", () => {
    const base = club();
    const zones = base.zones.map((zone) => (zone.id === ZONE_A
      ? { ...zone, kind: 'pc' as const, cpu: 'Intel Core i5-12400F', gpu: 'GeForce GTX 1660 Super', ram: '16 GB', monitor: 'MSI', monitor_size_inches: 25, monitor_refresh_hz: 300 }
      : { ...zone, kind: 'playstation' as const, console: 'PlayStation 5', controllers: 2 }));
    const { items } = buildYandexPriceItems({ ...base, zones });
    expect(items.map((entry) => [entry.name, entry.description])).toEqual([
      ['Игровой час — VIP зал', 'Intel Core i5-12400F, GeForce GTX 1660 Super, 16 GB RAM, монитор 25″ MSI 300 Гц.'],
      ['VIP — 3 часа (10:00–18:00)', 'Три часа днём. Intel Core i5-12400F, GeForce GTX 1660 Super, 16 GB RAM, монитор 25″ MSI 300 Гц.'],
      ['Игровой час — PlayStation', 'PlayStation 5, 2 геймпада.'],
      ['Ночной пакет', null],
    ]);
  });

  it('leaves the descriptions as they were for zones without spec fields', () => {
    expect(buildYandexPriceItems(club()).items.map((entry) => entry.description)).toEqual([null, 'Три часа днём.', null, null]);
  });

  it('keeps the price card pictures (and their version) whatever the description says', () => {
    const cardPictures = { baseUrl: 'https://pixelgaming.uz/api/showcase/price-card', slug: 'pixel-game-club', isCardImage: () => true };
    const plain = buildYandexPriceItems(club(), { cardPictures }).items;
    const base = club();
    const described = buildYandexPriceItems({ ...base, zones: base.zones.map((zone) => ({ ...zone, cpu: 'Ryzen 7 7800X3D', gpu: 'RTX 4070', mouse: 'Logitech G102' })) }, { cardPictures }).items;
    expect(described.map((entry) => entry.description)).not.toEqual(plain.map((entry) => entry.description));
    expect(described.map((entry) => entry.picture)).toEqual(plain.map((entry) => entry.picture));
  });

  it('skips zones without an hourly price and keeps ids stable', () => {
    const { items, skipped } = buildYandexPriceItems(club({ zones: [{ id: ZONE_A, name: 'VIP', price_per_hour: null, image_url: null, sort_order: 1 }], offers: [] }));
    expect(items).toEqual([]);
    expect(skipped).toEqual([{ kind: 'zone', id: ZONE_A, name: 'VIP', reason: 'no_price' }]);
    expect(yandexItemId('zone', ZONE_A)).toBe('z1111111122223333444');
    expect(yandexItemId('offer', ZONE_A)).toMatch(/^o[0-9a-f]{19}$/);
  });
});

const HOURLY = { id: '1', name: 'VIP' };
const COMBO = { id: '2', name: 'Комбо & акции' };
const item = (overrides: Partial<YandexPriceItem>): YandexPriceItem => ({
  id: 'z1', name: 'Час', price: 1, category: HOURLY, description: null, picture: null, zoneId: null,
  card: { label: 'VIP', headline: '1 час', timeWindow: null }, ...overrides,
});

describe('buildYandexYml', () => {
  it('follows the Yandex template and escapes text', () => {
    const items: YandexPriceItem[] = [
      item({ id: 'z1', name: 'Игровой час — VIP', price: 25000, picture: 'https://cdn.example.com/a.jpg?x=1&y=2' }),
      item({ id: 'o1', name: 'Combo <PS & PC>', price: 50000, category: COMBO, description: '"Ночь" 22:00–08:00' }),
    ];
    const yml = buildYandexYml(items, { clubName: 'Pixel -- Gaming' });
    expect(yml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(yml).toContain('<!-- Pixel - Gaming: price list');
    expect(yml).toContain('<category id="1">VIP</category>');
    expect(yml).toContain('<category id="2">Комбо &amp; акции</category>');
    expect(yml).toContain([
      '      <offer id="z1">',
      '        <name>Игровой час — VIP</name>',
      '        <price>25000</price>',
      '        <currencyId>UZS</currencyId>',
      '        <categoryId>1</categoryId>',
      '        <picture>https://cdn.example.com/a.jpg?x=1&amp;y=2</picture>',
      '      </offer>',
    ].join('\n'));
    expect(yml).toContain('<name>Combo &lt;PS &amp; PC&gt;</name>');
    expect(yml).toContain('<description>&quot;Ночь&quot; 22:00–08:00</description>');
    expect(yml.match(/<yml_catalog>[\s\S]*<shop>[\s\S]*<categories>[\s\S]*<\/categories>[\s\S]*<offers>[\s\S]*<\/offers>[\s\S]*<\/shop>[\s\S]*<\/yml_catalog>/)).not.toBeNull();
  });

  it('leaves out a category with no items', () => {
    const yml = buildYandexYml([item({})], { clubName: 'X' });
    expect(yml).not.toContain('Комбо');
    expect(yml.match(/<category /g)).toHaveLength(1);
  });

  it('drops characters XML cannot hold before escaping', () => {
    const yml = buildYandexYml([item({ name: 'Ча\u0000с\u0007 & \ud800VIP\u000b', description: 'Tab\there\nnew line\u001f' })], { clubName: 'X\u0001' });
    expect(yml).toContain('<name>Час &amp; VIP</name>');
    expect(yml).toContain('<description>Tab\there\nnew line</description>');
    expect(yml).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  });
});

describe('diffPriceList', () => {
  const next = buildYandexPriceItems(club()).items;

  it('finds added, removed and changed items by normalised name', () => {
    const diff = diffPriceList([
      { name: 'игровой час - vip  зал', price: 25000 },
      { name: 'Игровой час — PlayStation', price: 25000 },
      { name: 'Ночной пакет', price: 80000, description: 'Старое описание' },
      { name: 'Старая акция', price: 10000 },
    ], next);
    expect(diff.added.map((item) => item.name)).toEqual(['VIP — 3 часа (10:00–18:00)']);
    expect(diff.removed.map((item) => item.name)).toEqual(['Старая акция']);
    expect(diff.changed.map((change) => [change.name, change.fields])).toEqual([
      ['Игровой час — PlayStation', ['price']],
      ['Ночной пакет', ['description']],
    ]);
    const sum = (price: number) => `${formatCurrency(price)} сум`;
    expect(formatPriceDiff(diff)).toEqual([
      `+ VIP — 3 часа (10:00–18:00): ${sum(60000)}`,
      `− Старая акция: ${sum(10000)}`,
      `~ Игровой час — PlayStation: ${sum(25000)} → ${sum(30000)}`,
      '~ Ночной пакет: описание',
    ]);
    expect(sum(60000).replace(/\s/g, ' ')).toBe('60 000 сум');
  });

  it('reports no change for the same list', () => {
    const diff = diffPriceList(next.map((item) => ({ name: item.name, price: item.price, description: item.description })), next);
    expect(diff).toEqual({ added: [], removed: [], changed: [], renamed: [] });
    expect(formatPriceDiff(diff)).toEqual(['Без изменений: на карточке уже этот прайс-лист.']);
  });

  it('pairs a removed and an added item with the same price and words as a rename', () => {
    const list = (offers: YandexPriceClub['offers']) => buildYandexPriceItems(club({ zones: [], offers })).items;
    const offer = (n: number, title: string, price: number, time_window: string | null = null) => ({
      id: `${n}0000000-bbbb-cccc-dddd-eeeeeeeeeeee`, title, description: null, price, time_window, is_active: true, sort_order: n,
    });
    const next = list([
      offer(1, 'VIP · Ночной пакет', 75000, '23:00 - 06:00'),
      offer(2, 'Стандарт · 3+2 часа', 45000),
      offer(3, 'Стандарт · 1 час', 10000, '06:00 - 18:00'),
      offer(4, 'Стандарт · 1 час', 15000, '18:00 - 06:00'),
      offer(5, 'VIP · 3 часа', 30000),
    ]);
    const diff = diffPriceList([
      { name: 'Ночной пакет — VIP (23:00–06:00)', price: 75000 },
      { name: 'Стандарт — тариф 3+2 часа', price: 45000 },
      { name: 'Стандарт — 1 час (вечер и ночь)', price: 15000 },
      { name: 'Стандарт — 1 час (день)', price: 10000 },
      { name: 'VIP — 3 часа (день)', price: 25000 },
      { name: 'Без цены', price: null },
    ], next);
    expect(diff.renamed.map((rename) => [rename.before.name, rename.after.name])).toEqual([
      ['Ночной пакет — VIP (23:00–06:00)', 'VIP — Ночной пакет (23:00–06:00)'],
      ['Стандарт — тариф 3+2 часа', 'Стандарт — 3+2 часа'],
      ['Стандарт — 1 час (вечер и ночь)', 'Стандарт — 1 час (18:00–06:00)'],
      ['Стандарт — 1 час (день)', 'Стандарт — 1 час (06:00–18:00)'],
    ]);
    // Another price is a real change, not a rename.
    expect(diff.added.map((item) => item.name)).toEqual(['VIP — 3 часа']);
    expect(diff.removed.map((item) => item.name)).toEqual(['VIP — 3 часа (день)', 'Без цены']);
    expect(formatPriceDiff(diff)).toContain(`↻ Стандарт — тариф 3+2 часа → Стандарт — 3+2 часа: ${formatCurrency(45000)} сум`);
  });

  it('never takes two different windows at the same price for a rename', () => {
    const next = buildYandexPriceItems(club({ zones: [], offers: [
      { id: '10000000-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Стандарт · 1 час', description: null, price: 10000, time_window: '09:00 - 18:00', is_active: true, sort_order: 1 },
    ] })).items;
    const diff = diffPriceList([{ name: 'Стандарт — 1 час (06:00–18:00)', price: 10000 }], next);
    expect(diff.renamed).toEqual([]);
    expect(diff.added.map((entry) => entry.name)).toEqual(['Стандарт — 1 час (09:00–18:00)']);
    expect(diff.removed.map((entry) => entry.name)).toEqual(['Стандарт — 1 час (06:00–18:00)']);
  });

  it('compares names as word sets for renames', () => {
    expect(priceNameWords('Ночной пакет — VIP (23:00–06:00)')).toBe(priceNameWords('VIP · ночной ПАКЕТ (23:00-6:00)'));
    expect(priceNameWords('Тариф Стандарт 1 час (вечер и ночь)')).toBe(priceNameWords('Стандарт — 1 час 18:00-06:00'));
    expect(priceNameWords('Комбо (с сетом)')).not.toBe(priceNameWords('Комбо'));
    expect(priceNameWords('Стандарт — 1 час (день)')).toBe(priceNameWords('Стандарт — 1 час (6:00 - 18:00)'));
    // Only the exact day and evening windows read as those words.
    expect(priceNameWords('Стандарт — 1 час (день)')).not.toBe(priceNameWords('Стандарт — 1 час (18:00–06:00)'));
    expect(priceNameWords('Стандарт — 1 час (день)')).not.toBe(priceNameWords('Стандарт — 1 час (09:00–18:00)'));
    expect(priceNameWords('Стандарт — 1 час (день)')).not.toBe(priceNameWords('Стандарт — 1 час'));
    expect(priceNameWords('VIP — 3 часа (06:00–18:00)')).not.toBe(priceNameWords('VIP — 3 часа (10:00–18:00)'));
    expect(priceNameWords('2+1 часа')).not.toBe(priceNameWords('2 1 часа'));
  });

  it('normalises case, spaces, dashes and ё', () => {
    expect(normalizePriceName('  Ночной  Пакет — Всё ')).toBe(normalizePriceName('ночной пакет - все'));
  });
});

describe('parsePriceSnapshot', () => {
  it('reads an array or { items } and page-formatted prices', () => {
    expect(parsePriceSnapshot([{ name: ' VIP ', price: '25 000 сум' }, { name: '', price: 1 }, null])).toEqual([{ name: 'VIP', price: 25000 }]);
    expect(parsePriceSnapshot({ items: [{ name: 'PS', price: 30000.4, description: 'x' }, { name: 'Free' }] })).toEqual([
      { name: 'PS', price: 30000, description: 'x' },
      { name: 'Free', price: null },
    ]);
    expect(parsePriceSnapshot({ items: [{ name: 'A', price: '1 500,00 сум' }] })).toEqual([{ name: 'A', price: 1500 }]);
    expect(parsePriceSnapshot('nope')).toEqual([]);
  });
});

describe('snapshotPrice', () => {
  it('reads one number as the page writes it', () => {
    expect(snapshotPrice('25 000 сум')).toBe(25000);
    expect(snapshotPrice('от 25\u00a0000 сум')).toBe(25000);
    expect(snapshotPrice('25000')).toBe(25000);
    expect(snapshotPrice('1 500,50 сум')).toBe(1501);
    expect(snapshotPrice(30000.4)).toBe(30000);
  });

  it('returns null for no number or more than one', () => {
    expect(snapshotPrice('10 000 – 15 000 сум')).toBeNull();
    expect(snapshotPrice('2 часа за 50 000')).toBeNull();
    expect(snapshotPrice('по запросу')).toBeNull();
    expect(snapshotPrice(null)).toBeNull();
    expect(snapshotPrice(Number.NaN)).toBeNull();
  });
});

describe('yandexPriceClubFromShowcase', () => {
  it('reads the published page payload in its order, with every language', () => {
    const parsed = yandexPriceClubFromShowcase({
      slug: 'pixel-game-club',
      club_name: 'Pixel Gaming',
      logo_url: 'https://cdn.example.com/logo.png',
      zones: [
        { id: 'z-b', name: 'VIP', kind: 'pc', translations: { name: { ru: 'VIP зал' } }, price_per_hour: '25000', image_url: null },
        { id: 'z-a', name: 'PS5', kind: 'playstation', price_per_hour: 40000, image_url: '/playstation/ps5.svg' },
        { name: 'no id' },
      ],
      offers: [{ id: 'o-1', title: 'VIP · 1 hour', translations: { title: { ru: 'VIP · 1 час' } }, price: 20000, time_window: null }, null],
      games: [{ id: 'g-1', title: 'Dota 2', image_url: 'https://cdn.example.com/dota.jpg' }, { id: 'g-2' }],
    });
    expect(parsed?.slug).toBe('pixel-game-club');
    expect(parsed?.club.clubName).toBe('Pixel Gaming');
    expect(parsed?.club.zones.map((zone) => [zone.id, zone.kind, zone.price_per_hour, zone.sort_order])).toEqual([['z-b', 'pc', 25000, 0], ['z-a', 'playstation', 40000, 1]]);
    expect(parsed?.club.offers).toEqual([{
      id: 'o-1', title: 'VIP · 1 hour', description: null, translations: { title: { ru: 'VIP · 1 час' } }, price: 20000, time_window: null, is_active: true, sort_order: 0,
    }]);
    expect(parsed?.club.games).toEqual([{ id: 'g-1', title: 'Dota 2', image_url: 'https://cdn.example.com/dota.jpg', sort_order: 0 }]);
    expect(buildYandexPriceItems(parsed!.club).items.map((entry) => entry.name)).toEqual(['VIP — 1 час', 'Игровой час — PS5']);
  });

  it('reads the zone hardware so the card route describes items as the script does', () => {
    const zone = {
      id: '11111111-2222-3333-4444-555555555555', name: 'VIP', kind: 'pc', price_per_hour: 25000, image_url: null,
      cpu: 'Intel Core i5-12400F', gpu: 'GeForce GTX 1660 Super', ram: '16 GB', monitor: '', monitor_size_inches: '25', monitor_refresh_hz: 300,
      mouse: 'Logitech G102', keyboard: null, headset: null, chair: null, console: null, controllers: null, peripherals: 'Описание зоны',
    };
    const parsed = yandexPriceClubFromShowcase({ slug: 'pixel-game-club', zones: [zone], offers: [] })!;
    expect(parsed.club.zones[0]).toMatchObject({
      cpu: 'Intel Core i5-12400F', gpu: 'GeForce GTX 1660 Super', ram: '16 GB', monitor: null, monitor_size_inches: 25, monitor_refresh_hz: 300,
      mouse: 'Logitech G102', keyboard: null, console: null, controllers: null,
    });
    const fromRow = buildYandexPriceItems({
      logoUrl: null, offers: [],
      zones: [{ ...zone, kind: 'pc', monitor: null, monitor_size_inches: 25, sort_order: 0, translations: undefined }],
    }).items;
    expect(buildYandexPriceItems(parsed.club).items).toEqual(fromRow);
    expect(fromRow[0].description).toBe('Intel Core i5-12400F, GeForce GTX 1660 Super, 16 GB RAM, монитор 25″ 300 Гц, мышь Logitech G102.');
  });

  it('is null for an unknown or unpublished page', () => {
    expect(yandexPriceClubFromShowcase(null)).toBeNull();
    expect(yandexPriceClubFromShowcase({ club_name: 'X' })).toBeNull();
  });
});
