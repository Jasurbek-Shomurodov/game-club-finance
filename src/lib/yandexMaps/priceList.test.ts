import { describe, expect, it } from 'vitest';
import { formatCurrency } from '@/lib/formatters';
import {
  buildYandexPriceItems,
  buildYandexYml,
  diffPriceList,
  formatPriceDiff,
  normalizePriceName,
  parsePriceSnapshot,
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
  it('lists hourly prices by zone order, then active offers with prices', () => {
    const { items, skipped } = buildYandexPriceItems(club());
    expect(items.map((item) => [item.name, item.price, item.category])).toEqual([
      ['Игровой час — VIP зал', 25000, 'hourly'],
      ['Игровой час — PlayStation', 30000, 'hourly'],
      ['VIP — 3 часа (10:00–18:00)', 60000, 'offers'],
      ['Ночной пакет', 80000, 'offers'],
    ]);
    expect(skipped).toEqual([{ kind: 'offer', id: 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Турнир', reason: 'no_price' }]);
  });

  it('prefers the Russian text and keeps the time window in the name only', () => {
    const offer = buildYandexPriceItems(club()).items[2];
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
    expect(skipped).toEqual([{ kind: 'zone', id: ZONE_B, name: 'PlayStation', reason: 'hourly_offer' }]);
    const inactive = buildYandexPriceItems(club({ offers: [{ ...hourPackage, is_active: false }] }));
    expect(inactive.items.map((item) => item.name)).toContain('Игровой час — PlayStation');
    const threeHours = buildYandexPriceItems(club({ offers: [{ ...hourPackage, title: 'PlayStation · 3 часа' }] }));
    expect(threeHours.items.map((item) => item.name)).toContain('Игровой час — PlayStation');
  });

  it('uses the zone photo, else the club logo, else none', () => {
    const { items } = buildYandexPriceItems(club());
    expect(items[0].picture).toBe('https://cdn.example.com/vip.jpg');
    expect(items[1].picture).toBe('https://cdn.example.com/logo.png');
    expect(items[2].picture).toBe('https://cdn.example.com/vip.jpg');
    expect(items[3].picture).toBe('https://cdn.example.com/logo.png');
    expect(buildYandexPriceItems(club({ logoUrl: null })).items[3].picture).toBeNull();
  });

  it('skips zones without an hourly price and keeps ids stable', () => {
    const { items, skipped } = buildYandexPriceItems(club({ zones: [{ id: ZONE_A, name: 'VIP', price_per_hour: null, image_url: null, sort_order: 1 }], offers: [] }));
    expect(items).toEqual([]);
    expect(skipped).toEqual([{ kind: 'zone', id: ZONE_A, name: 'VIP', reason: 'no_price' }]);
    expect(yandexItemId('zone', ZONE_A)).toBe('z1111111122223333444');
    expect(yandexItemId('offer', ZONE_A)).toMatch(/^o[0-9a-f]{19}$/);
  });
});

describe('buildYandexYml', () => {
  it('follows the Yandex template and escapes text', () => {
    const items: YandexPriceItem[] = [
      { id: 'z1', name: 'Игровой час — VIP', price: 25000, category: 'hourly', description: null, picture: 'https://cdn.example.com/a.jpg?x=1&y=2' },
      { id: 'o1', name: 'Combo <PS & PC>', price: 50000, category: 'offers', description: '"Ночь" 22:00–08:00', picture: null },
    ];
    const yml = buildYandexYml(items, { clubName: 'Pixel -- Gaming' });
    expect(yml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(yml).toContain('<!-- Pixel - Gaming: price list');
    expect(yml).toContain('<category id="1">Игровое время</category>');
    expect(yml).toContain('<category id="2">Пакеты и акции</category>');
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
    const yml = buildYandexYml([{ id: 'z1', name: 'Час', price: 1, category: 'hourly', description: null, picture: null }], { clubName: 'X' });
    expect(yml).not.toContain('Пакеты и акции');
  });

  it('drops characters XML cannot hold before escaping', () => {
    const yml = buildYandexYml([{ id: 'z1', name: 'Ча\u0000с\u0007 & \ud800VIP\u000b', price: 1, category: 'hourly', description: 'Tab\there\nnew line\u001f', picture: null }], { clubName: 'X\u0001' });
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
    expect(diff).toEqual({ added: [], removed: [], changed: [] });
    expect(formatPriceDiff(diff)).toEqual(['Без изменений: на карточке уже этот прайс-лист.']);
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
