// What each Yandex Maps price card shows: the words (from the price item),
// the price, and the background, which is the cover of a popular game the
// club already lists on its public page (CS2, Dota 2, Warcraft III…) for a
// computer item, or the PlayStation zone's own picture for a console item.
// Only images the club already has are used; nothing is taken from the web.
// Pure: the same choice is made by `plan` and by the public card route, so a
// card's picture is the same on both. Drawn by priceCardImage.ts.

import type { YandexPriceClub, YandexPriceItem } from './priceList';

/** Bump when the card's look changes, so Yandex and caches load the new picture. */
export const PRICE_CARD_DESIGN_VERSION = 1;

/** A game the club's guests know best, matched by its title. */
export interface PopularGame {
  key: string;
  /** How the owner would name it when adding it. */
  title: string;
  /** Which price cards it suits. */
  platform: 'pc' | 'playstation';
  match: RegExp;
  /** One of the titles the cards should have: reported when the club has no cover for it. */
  wanted: boolean;
}

/** Most popular first: the first items of every zone get these. */
export const POPULAR_GAMES: readonly PopularGame[] = [
  { key: 'cs2', title: 'Counter-Strike 2', platform: 'pc', wanted: true, match: /\bcs ?2\b|\bcs:? ?go\b|counter[- ]?strike/ },
  { key: 'dota', title: 'Dota 2', platform: 'pc', wanted: true, match: /\bdota\b/ },
  { key: 'warcraft', title: 'Warcraft III / ICCup', platform: 'pc', wanted: true, match: /^(?!.*world of warcraft).*(warcraft|\biccup\b|\bwc ?3\b)/ },
  { key: 'pubg', title: 'PUBG', platform: 'pc', wanted: true, match: /\bpubg\b|playerunknown/ },
  { key: 'valorant', title: 'Valorant', platform: 'pc', wanted: true, match: /\bvalorant\b/ },
  { key: 'fortnite', title: 'Fortnite', platform: 'pc', wanted: true, match: /\bfortnite\b/ },
  { key: 'gta', title: 'GTA V', platform: 'pc', wanted: true, match: /\bgta\b|grand theft auto/ },
  // Club favourites after the big titles: used once those run out.
  { key: 'tanks', title: 'Мир танков', platform: 'pc', wanted: false, match: /мир танков|world of tanks/ },
  { key: 'nfs', title: 'Need for Speed', platform: 'pc', wanted: false, match: /need for speed|\bnfs\b/ },
  { key: 'wow', title: 'World of Warcraft', platform: 'pc', wanted: false, match: /world of warcraft|\bwow\b/ },
  { key: 'lineage', title: 'Lineage II', platform: 'pc', wanted: false, match: /lineage/ },
  { key: 'fc', title: 'EA Sports FC / FIFA', platform: 'playstation', wanted: true, match: /\bfifa\b|\bea sports fc\b|\bfc ?\d{2}\b/ },
];

const gameTitle = (title: string) => title.toLocaleLowerCase('ru').replace(/\s+/g, ' ').trim();

/** The popular game a title is, or null. */
export function popularGame(title: string): PopularGame | null {
  const normalized = gameTitle(title);
  return POPULAR_GAMES.find((game) => game.match.test(normalized)) ?? null;
}

type CardGame = NonNullable<YandexPriceClub['games']>[number];

/**
 * The club's popular games with a usable cover, most popular first (the
 * club's own order among games of one title). A console card prefers console
 * games; a computer card never shows one.
 */
export function popularGameCovers(games: readonly CardGame[], platform: 'pc' | 'playstation', isCardImage: (url: string) => boolean): string[] {
  const rank = (game: PopularGame) => POPULAR_GAMES.indexOf(game);
  return games
    .flatMap((game) => {
      const popular = popularGame(game.title);
      const url = game.image_url?.trim();
      return popular && popular.platform === platform && url && isCardImage(url) ? [{ popular, url, sort: game.sort_order }] : [];
    })
    .sort((a, b) => rank(a.popular) - rank(b.popular) || a.sort - b.sort)
    .map((game) => game.url)
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

export interface PriceCardContent {
  itemId: string;
  /** The wordmark at the top ("PIXEL GAMING"). */
  brand: string;
  logoUrl: string | null;
  label: string;
  headline: string;
  timeWindow: string | null;
  /** Whole UZS. */
  price: number;
  /** Cover drawn behind the text, darkened; the brand gradient when null. */
  background: string | null;
  /** Changes whenever what the card draws changes. */
  version: string;
}

/** FNV-1a, as 8 hex digits: a short, stable fingerprint of the card. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** "Pixel Gaming (Algoritm)" → "PIXEL GAMING": the brand, without the branch. */
export function priceCardBrand(clubName: string | null | undefined): string {
  const brand = (clubName ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return (brand || 'Pixel Gaming').toLocaleUpperCase('ru');
}

/**
 * One card per item. Within a category, consecutive items take consecutive
 * covers (Стандарт · 1 час → CS2, 2+1 → Dota 2…), and each category starts one
 * cover further on, so neighbouring zones do not open with the same picture.
 * A PlayStation zone shows its own picture and console games; every other
 * item the computer games. Without covers, the zone's own picture, else the
 * gradient.
 */
export function yandexPriceCards(club: YandexPriceClub, items: readonly YandexPriceItem[], isCardImage: (url: string) => boolean): PriceCardContent[] {
  const games = club.games ?? [];
  const allowed = (url: string | null | undefined) => {
    const trimmed = url?.trim();
    return trimmed && isCardImage(trimmed) ? trimmed : null;
  };
  const pcCovers = popularGameCovers(games, 'pc', isCardImage);
  const consoleCovers = popularGameCovers(games, 'playstation', isCardImage);
  const logoUrl = allowed(club.logoUrl);
  const brand = priceCardBrand(club.clubName);
  const positions = new Map<string, number>();

  return items.map((item) => {
    const zone = item.zoneId ? club.zones.find((candidate) => candidate.id === item.zoneId) ?? null : null;
    const position = positions.get(item.category.id) ?? 0;
    positions.set(item.category.id, position + 1);
    const ownPicture = allowed(zone?.image_url);
    const isConsole = zone?.kind === 'playstation';
    const pool = isConsole ? [...(ownPicture ? [ownPicture] : []), ...consoleCovers] : pcCovers;
    // A console zone always opens with its own picture; computer categories each start one cover further on.
    const offset = isConsole ? 0 : Math.max(0, (Number.parseInt(item.category.id, 10) || 1) - 1);
    const background = pool.length ? pool[(offset + position) % pool.length] : ownPicture;
    const content = {
      itemId: item.id,
      brand,
      logoUrl,
      label: item.card.label,
      headline: item.card.headline,
      timeWindow: item.card.timeWindow,
      price: item.price,
      background,
    };
    return { ...content, version: fingerprint(JSON.stringify([PRICE_CARD_DESIGN_VERSION, content])) };
  });
}

/** `<baseUrl>/<slug>/<itemId>.png?v=<version>`: a new address whenever the card changes, so Yandex fetches it again. */
export function priceCardUrl(baseUrl: string, slug: string, card: Pick<PriceCardContent, 'itemId' | 'version'>): string {
  return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(slug)}/${card.itemId}.png?v=${card.version}`;
}

export interface GameCoverReport {
  /** The club's games that have a cover the cards can use. */
  withCover: string[];
  /** Popular games the club does not list, or lists without a usable cover. */
  missing: string[];
}

/** For the owner: which popular games could still be added (with a cover) to vary the cards. */
export function gameCoverReport(games: readonly CardGame[], isCardImage: (url: string) => boolean): GameCoverReport {
  const covered = games.filter((game) => game.image_url?.trim() && isCardImage(game.image_url.trim()));
  return {
    withCover: covered.map((game) => game.title.trim()),
    missing: POPULAR_GAMES.filter((popular) => popular.wanted && !covered.some((game) => popularGame(game.title) === popular)).map((popular) => popular.title),
  };
}
