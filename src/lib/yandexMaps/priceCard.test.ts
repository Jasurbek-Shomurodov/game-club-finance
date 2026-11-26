import { describe, expect, it } from 'vitest';
import { gameCoverReport, popularGame, popularGameCovers, priceCardBrand, priceCardUrl, yandexPriceCards } from './priceCard';
import { buildYandexPriceItems, type YandexPriceClub } from './priceList';

const CDN = 'https://cdn.example.com/';
const allowed = (url: string) => url.startsWith(CDN) || url.startsWith('/playstation/');
const offer = (n: number, title: string, price = 10000 * n) => ({
  id: `${n}0000000-bbbb-cccc-dddd-eeeeeeeeeeee`, title, description: null, price, time_window: null, is_active: true, sort_order: n,
});

function club(overrides: Partial<YandexPriceClub> = {}): YandexPriceClub {
  return {
    clubName: 'Pixel Gaming (Algoritm)',
    logoUrl: `${CDN}logo.png`,
    zones: [
      { id: 'zone-std', kind: 'pc', name: 'Стандарт', price_per_hour: null, image_url: `${CDN}standard.jpg`, sort_order: 1 },
      { id: 'zone-vip', kind: 'pc', name: 'VIP', price_per_hour: null, image_url: `${CDN}vip.jpg`, sort_order: 2 },
      { id: 'zone-ps', kind: 'playstation', name: 'PlayStation 5', price_per_hour: 40000, image_url: '/playstation/ps5.svg', sort_order: 3 },
    ],
    offers: [
      offer(1, 'Стандарт · 1 час'), offer(2, 'Стандарт · 2+1 часа'), offer(3, 'Стандарт · 3+2 часа'),
      offer(4, 'VIP · 1 час'), offer(5, 'VIP · 2+1 часа'), offer(6, 'Комбо: 7 часов + сет ZarKebab'),
    ],
    games: [
      { id: 'g1', title: 'Need for Speed: Carbon', image_url: `${CDN}nfs.jpg`, sort_order: 1 },
      { id: 'g2', title: 'Dota 2', image_url: `${CDN}dota.jpg`, sort_order: 2 },
      { id: 'g3', title: 'Counter-Strike 2', image_url: `${CDN}cs2.jpg`, sort_order: 3 },
      { id: 'g4', title: 'Warcraft III', image_url: `${CDN}wc3.jpg`, sort_order: 4 },
      { id: 'g5', title: 'FIFA 19', image_url: `${CDN}fifa.jpg`, sort_order: 5 },
      { id: 'g6', title: 'PUBG', image_url: 'https://elsewhere.example.org/pubg.jpg', sort_order: 6 },
      { id: 'g7', title: 'World of Warcraft', image_url: null, sort_order: 7 },
      { id: 'g8', title: 'Chess', image_url: `${CDN}chess.jpg`, sort_order: 8 },
    ],
    ...overrides,
  };
}

const cardsOf = (value: YandexPriceClub) => yandexPriceCards(value, buildYandexPriceItems(value).items, allowed);

describe('popularGame', () => {
  it('matches the titles guests ask for', () => {
    expect(popularGame('CS2')?.key).toBe('cs2');
    expect(popularGame('Counter Strike: Global Offensive')?.key).toBe('cs2');
    expect(popularGame('DOTA 2')?.key).toBe('dota');
    expect(popularGame('Warcraft III: The Frozen Throne')?.key).toBe('warcraft');
    expect(popularGame('iCCup')?.key).toBe('warcraft');
    expect(popularGame('World of Warcraft: The Burning Crusade')?.key).toBe('wow');
    expect(popularGame('EA Sports FC 25')?.key).toBe('fc');
    expect(popularGame('FC25')?.key).toBe('fc');
    expect(popularGame('Мир танков')?.key).toBe('tanks');
    expect(popularGame('Chess')).toBeNull();
  });
});

describe('popularGameCovers', () => {
  it('orders the club’s covers by popularity, by platform, only from allowed hosts', () => {
    const games = club().games!;
    expect(popularGameCovers(games, 'pc', allowed)).toEqual([`${CDN}cs2.jpg`, `${CDN}dota.jpg`, `${CDN}wc3.jpg`, `${CDN}nfs.jpg`]);
    expect(popularGameCovers(games, 'playstation', allowed)).toEqual([`${CDN}fifa.jpg`]);
  });
});

describe('popularGameCovers ties', () => {
  it('keeps games of one title and sort order in the order given', () => {
    const games = [
      { id: 'a', title: 'Warcraft III', image_url: `${CDN}wc3-b.jpg`, sort_order: 1 },
      { id: 'b', title: 'iCCup', image_url: `${CDN}iccup.jpg`, sort_order: 1 },
      { id: 'c', title: 'Warcraft III: Reforged', image_url: `${CDN}wc3-a.jpg`, sort_order: 0 },
    ];
    expect(popularGameCovers(games, 'pc', allowed)).toEqual([`${CDN}wc3-a.jpg`, `${CDN}wc3-b.jpg`, `${CDN}iccup.jpg`]);
  });
});

describe('yandexPriceCards', () => {
  it('gives consecutive covers within a zone, each zone starting one further on', () => {
    const cards = cardsOf(club());
    expect(cards.map((card) => [card.label, card.headline, card.background])).toEqual([
      ['Стандарт', '1 час', `${CDN}cs2.jpg`],
      ['Стандарт', '2+1 часа', `${CDN}dota.jpg`],
      ['Стандарт', '3+2 часа', `${CDN}wc3.jpg`],
      ['VIP', '1 час', `${CDN}dota.jpg`],
      ['VIP', '2+1 часа', `${CDN}wc3.jpg`],
      ['PlayStation 5', '1 час', '/playstation/ps5.svg'],
      ['Комбо', '7 часов + сет ZarKebab', `${CDN}nfs.jpg`],
    ]);
    expect(cards.every((card) => card.brand === 'PIXEL GAMING' && card.logoUrl === `${CDN}logo.png`)).toBe(true);
  });

  it('is the same on every run and changes its version only when the card does', () => {
    const first = cardsOf(club());
    expect(cardsOf(club())).toEqual(first);
    const repriced = cardsOf(club({ offers: club().offers.map((entry, i) => (i === 0 ? { ...entry, price: 12345 } : entry)) }));
    expect(repriced[0].version).not.toBe(first[0].version);
    expect(repriced.slice(1).map((card) => card.version)).toEqual(first.slice(1).map((card) => card.version));
  });

  it('falls back to the zone photo, then to none', () => {
    const cards = cardsOf(club({ games: [] }));
    expect(cards.map((card) => card.background)).toEqual([
      `${CDN}standard.jpg`, `${CDN}standard.jpg`, `${CDN}standard.jpg`, `${CDN}vip.jpg`, `${CDN}vip.jpg`, '/playstation/ps5.svg', null,
    ]);
    const blocked = yandexPriceCards(club({ games: [] }), buildYandexPriceItems(club({ games: [] })).items, () => false);
    expect(blocked.every((card) => card.background === null && card.logoUrl === null)).toBe(true);
  });

  it('gives a console zone its own picture first, then console games', () => {
    const ps = club({ offers: [offer(1, 'PlayStation 5 · 1 час'), offer(2, 'PlayStation 5 · 3 часа')] });
    expect(cardsOf(ps).filter((card) => card.label === 'PlayStation 5').map((card) => card.background)).toEqual(['/playstation/ps5.svg', `${CDN}fifa.jpg`]);
  });
});

describe('priceCardUrl and priceCardBrand', () => {
  it('builds the card address with its version', () => {
    expect(priceCardUrl('https://pixelgaming.uz/api/showcase/price-card/', 'pixel-game-club', { itemId: 'o123', version: 'abcd1234' }))
      .toBe('https://pixelgaming.uz/api/showcase/price-card/pixel-game-club/o123.png?v=abcd1234');
  });

  it('drops the branch from the wordmark', () => {
    expect(priceCardBrand('Pixel Gaming (Algoritm)')).toBe('PIXEL GAMING');
    expect(priceCardBrand('')).toBe('PIXEL GAMING');
    expect(priceCardBrand(undefined)).toBe('PIXEL GAMING');
  });
});

describe('gameCoverReport', () => {
  it('lists the covers the club has and the wanted titles it lacks', () => {
    expect(gameCoverReport(club().games!, allowed)).toEqual({
      withCover: ['Need for Speed: Carbon', 'Dota 2', 'Counter-Strike 2', 'Warcraft III', 'FIFA 19', 'Chess'],
      missing: ['PUBG', 'Valorant', 'Fortnite', 'GTA V'],
    });
  });
});
