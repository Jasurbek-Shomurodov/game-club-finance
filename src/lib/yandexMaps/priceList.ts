// The club's Yandex Maps price list ("Товары и услуги" in Yandex Business),
// built from the app: each zone's hourly price and every active package or
// offer. Yandex has no API for it; the YML this builds is uploaded by hand
// (docs/runbooks/yandex-maps-sync.md), and an upload replaces the whole list.
// Pure, so it is tested without the database.

import { formatCurrency } from '@/lib/formatters';
import { normalizeExternalUrl, packageHours, pickLocalized, splitOfferTitle } from '@/lib/showcase';
import type { ShowcaseGame, ShowcaseOffer, ShowcasePcZone } from '@/types';
import { priceCardUrl, yandexPriceCards } from './priceCard';
import { describeWithZoneSpecs, YANDEX_ZONE_SPEC_NUMBER_FIELDS, YANDEX_ZONE_SPEC_TEXT_FIELDS, type YandexZoneSpecs } from './zoneSpecs';

/** A section of the list: one per zone in zone order, then combos and promotions. `id` is the YML `categoryId`. */
export interface YandexPriceCategory {
  id: string;
  name: string;
}

/** Offers that belong to no zone ("Комбо: 7 часов + сет ZarKebab"). */
export const YANDEX_COMBO_CATEGORY_NAME = 'Комбо и акции';

export interface YandexPriceClub {
  /** Drawn on the price cards; the brand wordmark when absent. */
  clubName?: string;
  logoUrl: string | null;
  /** With the zone's hardware when known: it is written into its items' descriptions. */
  zones: Array<Pick<ShowcasePcZone, 'id' | 'kind' | 'name' | 'translations' | 'price_per_hour' | 'image_url' | 'sort_order'> & YandexZoneSpecs>;
  offers: Array<Pick<ShowcaseOffer, 'id' | 'title' | 'description' | 'translations' | 'price' | 'time_window' | 'is_active' | 'sort_order'>>;
  /** The club's games: their covers are the price cards' backgrounds. */
  games?: Array<Pick<ShowcaseGame, 'id' | 'title' | 'image_url' | 'sort_order'>>;
}

/** The words a price card draws for an item. */
export interface YandexPriceCardText {
  /** Small line above the headline: the zone ("VIP"), or "Комбо" for a combo. */
  label: string;
  /** The package itself: "7 часов", "2+1 часа", "Ночной пакет", "1 час". */
  headline: string;
  timeWindow: string | null;
}

export interface YandexPriceItem {
  /** Stable across runs: Latin letters and digits, at most 20 characters (the YML offer id rule). */
  id: string;
  name: string;
  /** Whole UZS. */
  price: number;
  category: YandexPriceCategory;
  /** The offer's text, then the zone's hardware (zoneSpecs.ts); at most 250 characters. */
  description: string | null;
  picture: string | null;
  /** The zone it is sold in; null for a combo or promotion. */
  zoneId: string | null;
  card: YandexPriceCardText;
}

/** A zone or offer left off the list, so the run can say why. */
export interface YandexSkippedItem {
  kind: 'zone' | 'offer';
  id: string;
  name: string;
  /** `hourly_offer`: an active 1-hour package of the zone already carries its hourly price. */
  reason: 'no_price' | 'hourly_offer';
}

export interface YandexPriceList {
  items: YandexPriceItem[];
  skipped: YandexSkippedItem[];
}

/** The branded price cards as the items' pictures (`<baseUrl>/<slug>/<id>.png`), instead of the zone photo or logo. */
export interface YandexCardPictures {
  baseUrl: string;
  /** The club's public page slug; the card route reads only that page's published data. */
  slug: string;
  /** Images the card route may fetch (the showcase storage bucket and the built-in console pictures). */
  isCardImage: (url: string) => boolean;
}

/**
 * YML offer ids may only hold Latin letters and digits, up to 20 characters,
 * so a row's uuid is shortened: `z`/`o` and its first 19 hex digits.
 */
export function yandexItemId(kind: 'zone' | 'offer', uuid: string): string {
  return `${kind === 'zone' ? 'z' : 'o'}${uuid.replace(/[^0-9a-z]/gi, '').toLowerCase().slice(0, 19)}`;
}

const wholePrice = (value: number | null | undefined) => {
  const price = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  return price > 0 ? price : null;
};

const bySortOrder = <T extends { sort_order: number }>(rows: readonly T[]) => [...rows].sort((a, b) => a.sort_order - b.sort_order);
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('ru') === b.trim().toLocaleLowerCase('ru');

/** The app's title separator ("Стандарт · 1 час") as the card writes it ("Стандарт — 1 час"). */
export function yandexItemName(title: string): string {
  return title.trim().replace(/\s+[·•|—–-]\s+/g, ' — ').replace(/\s+/g, ' ');
}

/** "06:00 - 18:00" → "06:00–18:00"; any other text is only trimmed. */
function timeWindowLabel(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const range = /^(\d{1,2}[:.]\d{2})\s*[-‐-―−]\s*(\d{1,2}[:.]\d{2})$/.exec(trimmed);
  return range ? `${range[1]}–${range[2]}` : trimmed;
}

/** "Комбо: 7 часов + сет" → label "Комбо", headline "7 часов + сет"; any other title is all headline. */
function comboCardText(title: string): Pick<YandexPriceCardText, 'label' | 'headline'> {
  const prefixed = /^([^:]{2,24}):\s*(\S.*)$/.exec(title.trim());
  return prefixed ? { label: prefixed[1].trim(), headline: prefixed[2].trim() } : { label: YANDEX_COMBO_CATEGORY_NAME, headline: title.trim() };
}

/**
 * Yandex shows items by name, so each must be unique: a repeated name gets its
 * price, and a name still repeated after that a running number.
 */
function uniqueNames(items: YandexPriceItem[]): YandexPriceItem[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(normalizePriceName(item.name), (counts.get(normalizePriceName(item.name)) ?? 0) + 1);
  const priced = items.map((item) => (counts.get(normalizePriceName(item.name))! > 1 ? { ...item, name: `${item.name} — ${formatCurrency(item.price)} сум` } : item));
  const seen = new Map<string, number>();
  return priced.map((item) => {
    const key = normalizePriceName(item.name);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n > 1 ? { ...item, name: `${item.name} (${n})` } : item;
  });
}

/**
 * Every price on the club's Yandex Maps card, one category per zone in zone
 * order (its hour first, then its packages), then one per other title prefix
 * ("Pro · 1 час" when the page lists no Pro zone), then combos and promotions.
 * Category ids count up in that order.
 */
export function buildYandexPriceItems(club: YandexPriceClub, options: { cardPictures?: YandexCardPictures | null } = {}): YandexPriceList {
  const skipped: YandexSkippedItem[] = [];
  const logo = normalizeExternalUrl(club.logoUrl);
  const zones = bySortOrder(club.zones).map((zone, index) => {
    const label = pickLocalized(zone.translations?.name, 'ru', zone.name) ?? zone.name;
    return {
      zone,
      names: [zone.name, ...Object.values(zone.translations?.name ?? {})].filter((name): name is string => Boolean(name?.trim())),
      label,
      category: { id: String(index + 1), name: label },
      picture: normalizeExternalUrl(zone.image_url),
    };
  });
  const packagesByZone = new Map<string, YandexPriceItem[]>();
  /** Offers titled for a zone the page does not list ("Pro · 1 час"): a category of their own, after the zones. */
  const otherGroups = new Map<string, { name: string; items: Array<Omit<YandexPriceItem, 'category'>> }>();
  const combos: Array<Omit<YandexPriceItem, 'category'>> = [];
  /** Zones with an active, priced 1-hour package: their hourly item would repeat it. */
  const zonesWithHourPackage = new Set<string>();

  for (const offer of bySortOrder(club.offers)) {
    if (!offer.is_active) continue;
    const title = offer.translations?.title?.ru?.trim() || offer.title.trim();
    const timeWindow = offer.time_window?.trim() ? timeWindowLabel(offer.time_window) : null;
    const name = `${yandexItemName(title)}${timeWindow ? ` (${timeWindow})` : ''}`;
    const price = wholePrice(offer.price);
    if (!price) {
      skipped.push({ kind: 'offer', id: offer.id, name, reason: 'no_price' });
      continue;
    }
    const description = offer.translations?.description?.ru?.trim() || offer.description?.trim() || null;
    const shown = splitOfferTitle(title);
    const split = splitOfferTitle(offer.title).zone ? splitOfferTitle(offer.title) : shown;
    const zone = split.zone ? zones.find((candidate) => candidate.names.some((zoneName) => sameName(zoneName, split.zone!))) : undefined;
    const base = { id: yandexItemId('offer', offer.id), name, price, description };
    if (!zone && split.zone) {
      const groupName = (shown.zone ?? split.zone).trim();
      const key = normalizePriceName(groupName);
      const group = otherGroups.get(key) ?? { name: groupName, items: [] };
      group.items.push({ ...base, picture: logo, zoneId: null, card: { label: group.name, headline: (shown.zone ? shown.length : split.length).trim(), timeWindow } });
      otherGroups.set(key, group);
      continue;
    }
    if (!zone) {
      combos.push({ ...base, picture: logo, zoneId: null, card: { ...comboCardText(title), timeWindow } });
      continue;
    }
    if (packageHours(split.length) === 1) zonesWithHourPackage.add(zone.zone.id);
    const headline = (shown.zone ? shown.length : split.length).trim();
    const list = packagesByZone.get(zone.zone.id) ?? [];
    list.push({
      ...base, description: describeWithZoneSpecs(description, zone.zone), category: zone.category, picture: zone.picture ?? logo, zoneId: zone.zone.id,
      card: { label: zone.label, headline, timeWindow },
    });
    packagesByZone.set(zone.zone.id, list);
  }

  const items: YandexPriceItem[] = [];
  for (const { zone, label, category, picture } of zones) {
    const price = wholePrice(zone.price_per_hour);
    if (zonesWithHourPackage.has(zone.id)) skipped.push({ kind: 'zone', id: zone.id, name: label, reason: 'hourly_offer' });
    else if (!price) skipped.push({ kind: 'zone', id: zone.id, name: label, reason: 'no_price' });
    else {
      items.push({
        id: yandexItemId('zone', zone.id), name: `Игровой час — ${label}`, price, category, description: describeWithZoneSpecs(null, zone),
        picture: picture ?? logo, zoneId: zone.id, card: { label, headline: '1 час', timeWindow: null },
      });
    }
    items.push(...(packagesByZone.get(zone.id) ?? []));
  }
  let nextCategory = zones.length + 1;
  for (const group of otherGroups.values()) {
    const category = { id: String(nextCategory++), name: group.name };
    items.push(...group.items.map((item) => ({ ...item, category })));
  }
  const combo = { id: String(nextCategory), name: YANDEX_COMBO_CATEGORY_NAME };
  items.push(...combos.map((item) => ({ ...item, category: combo })));

  const unique = uniqueNames(items);
  const cardPictures = options.cardPictures;
  if (!cardPictures) return { items: unique, skipped };
  const cards = new Map(yandexPriceCards(club, unique, cardPictures.isCardImage).map((card) => [card.itemId, card]));
  return {
    items: unique.map((item) => ({ ...item, picture: priceCardUrl(cardPictures.baseUrl, cardPictures.slug, cards.get(item.id)!) })),
    skipped,
  };
}

/** Characters XML 1.0 does not allow at all (control characters, lone surrogates), even escaped. */
const XML_INVALID = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

const escapeXml = (value: string) => value.replace(XML_INVALID, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

/** The list as YML, in the shape of Yandex's own template (`/sprav/templates/price-list-template.xml`). */
export function buildYandexYml(items: readonly YandexPriceItem[], { clubName }: { clubName: string }): string {
  const categories = [...new Map(items.map((item) => [item.category.id, item.category])).values()]
    .map((category) => `      <category id="${escapeXml(category.id)}">${escapeXml(category.name)}</category>`);
  const offers = items.map((item) => [
    `      <offer id="${escapeXml(item.id)}">`,
    `        <name>${escapeXml(item.name)}</name>`,
    `        <price>${item.price}</price>`,
    '        <currencyId>UZS</currencyId>',
    `        <categoryId>${escapeXml(item.category.id)}</categoryId>`,
    ...(item.picture ? [`        <picture>${escapeXml(item.picture)}</picture>`] : []),
    ...(item.description ? [`        <description>${escapeXml(item.description)}</description>`] : []),
    '      </offer>',
  ].join('\n'));
  // A comment may not hold "--".
  const label = clubName.replace(XML_INVALID, '').replace(/-{2,}/g, '-').replace(/-$/, '').trim();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- ${label}: price list from Game Club Finance. Uploading it replaces the whole list. -->`,
    '<yml_catalog>',
    '  <shop>',
    '    <categories>',
    ...categories,
    '    </categories>',
    '    <offers>',
    ...offers,
    '    </offers>',
    '  </shop>',
    '</yml_catalog>',
    '',
  ].join('\n');
}

/** One line of the card's current list, as read from the Yandex Business page. */
export interface YandexPriceSnapshotItem {
  name: string;
  price: number | null;
  /** Left out when the page did not show it; then descriptions are not compared. */
  description?: string | null;
}

export interface YandexPriceChange {
  name: string;
  before: YandexPriceSnapshotItem;
  after: YandexPriceItem;
  fields: Array<'price' | 'description'>;
}

/** An item the card lists under another name: same price, same words. */
export interface YandexPriceRename {
  before: YandexPriceSnapshotItem;
  after: YandexPriceItem;
}

export interface YandexPriceDiff {
  added: YandexPriceItem[];
  removed: YandexPriceSnapshotItem[];
  changed: YandexPriceChange[];
  renamed: YandexPriceRename[];
}

/** "Игровой час - VIP " and "игровой час — vip" are the same item. */
export function normalizePriceName(name: string): string {
  return name
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[‐-―−\-·•|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TIME_RANGE = /(\d{1,2})[:.](\d{2})\s*[-‐-―−]\s*(\d{1,2})[:.](\d{2})/g;

/**
 * The two windows the card used to write in words: a day rate "(день)" is
 * 06:00–18:00 and an evening rate "(вечер и ночь)" is 18:00–06:00. Only these
 * exact windows read as those words; any other window stays a window of its own.
 */
const WINDOW_WORDS: Record<string, string> = { t0600t1800: 'день', t1800t0600: 'вечер и ночь' };

/**
 * A name's words, as a sorted set, for spotting a rename: order, punctuation
 * and "тариф" do not count, and a time window is one word ("t2300t0600"), or
 * the day/evening words for the two windows above. "Ночной пакет — VIP
 * (23:00–06:00)" matches "VIP — Ночной пакет (23:00–06:00)", and
 * "1 час (день)" matches "1 час (06:00–18:00)", but two different windows never match.
 */
export function priceNameWords(name: string): string {
  const lower = name.toLocaleLowerCase('ru').replace(/ё/g, 'е');
  const withWindows = lower.replace(TIME_RANGE, (_range, fromHour: string, fromMinute: string, toHour: string, toMinute: string) => {
    const key = `t${fromHour.padStart(2, '0')}${fromMinute}t${toHour.padStart(2, '0')}${toMinute}`;
    return ` ${WINDOW_WORDS[key] ?? key} `;
  });
  const words = withWindows.split(/[^0-9a-zа-я+]+/).filter((word) => word && word !== 'тариф' && word !== '+');
  return [...new Set(words)].sort().join(' ');
}

const normalizeDescription = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/** One number as the page writes it: "25 000", "25000", "1 500,00". */
const PRICE_NUMBER = /\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g;

/**
 * A price as the page shows it ("25 000 сум", "25000") as whole UZS; null when
 * there is none, or more than one number ("10 000 – 15 000 сум") so it is ambiguous.
 */
export function snapshotPrice(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const numbers = value.match(PRICE_NUMBER) ?? [];
  if (numbers.length !== 1) return null;
  return Math.round(Number(numbers[0].replace(/[ \u00a0\u202f]/g, '').replace(',', '.')));
}

/** The saved `current-<orgId>.json`: an array of items, or `{ items: [...] }`. Unusable rows are dropped. */
export function parsePriceSnapshot(json: unknown): YandexPriceSnapshotItem[] {
  const rows = Array.isArray(json) ? json : json && typeof json === 'object' && Array.isArray((json as { items?: unknown }).items) ? (json as { items: unknown[] }).items : [];
  return rows.flatMap((row): YandexPriceSnapshotItem[] => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) return [];
    return [{
      name,
      price: snapshotPrice(record.price),
      ...('description' in record ? { description: typeof record.description === 'string' ? record.description : null } : {}),
    }];
  });
}

/** What uploading `next` would change on the card, matched by normalised name. */
export function diffPriceList(current: readonly YandexPriceSnapshotItem[], next: readonly YandexPriceItem[]): YandexPriceDiff {
  const currentByName = new Map(current.map((item) => [normalizePriceName(item.name), item]));
  const nextNames = new Set(next.map((item) => normalizePriceName(item.name)));
  const added: YandexPriceItem[] = [];
  const changed: YandexPriceChange[] = [];
  for (const item of next) {
    const before = currentByName.get(normalizePriceName(item.name));
    if (!before) {
      added.push(item);
      continue;
    }
    const fields: YandexPriceChange['fields'] = [];
    if (before.price !== item.price) fields.push('price');
    if (before.description !== undefined && normalizeDescription(before.description) !== normalizeDescription(item.description)) fields.push('description');
    if (fields.length) changed.push({ name: item.name, before, after: item, fields });
  }
  const unmatched = current.filter((item) => !nextNames.has(normalizePriceName(item.name)));
  const renamed: YandexPriceRename[] = [];
  const removed: YandexPriceSnapshotItem[] = [];
  for (const before of unmatched) {
    const words = priceNameWords(before.name);
    const index = before.price === null ? -1 : added.findIndex((item) => item.price === before.price && priceNameWords(item.name) === words);
    if (index < 0) {
      removed.push(before);
      continue;
    }
    renamed.push({ before, after: added[index] });
    added.splice(index, 1);
  }
  return { added, removed, changed, renamed };
}

const sum = (price: number | null) => (price === null ? 'без цены' : `${formatCurrency(price)} сум`);

/** The diff as lines for the owner to read before the upload. */
export function formatPriceDiff(diff: YandexPriceDiff): string[] {
  if (!diff.added.length && !diff.removed.length && !diff.changed.length && !diff.renamed.length) return ['Без изменений: на карточке уже этот прайс-лист.'];
  return [
    ...diff.added.map((item) => `+ ${item.name}: ${sum(item.price)}`),
    ...diff.removed.map((item) => `− ${item.name}: ${sum(item.price)}`),
    ...diff.changed.map((change) => `~ ${change.name}: ${change.fields.map((field) => (field === 'price'
      ? `${sum(change.before.price)} → ${sum(change.after.price)}`
      : 'описание')).join(', ')}`),
    ...diff.renamed.map((rename) => `↻ ${rename.before.name} → ${rename.after.name}: ${sum(rename.after.price)}`),
  ];
}

const payloadText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const payloadNumber = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const payloadRows = (value: unknown) => (Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : []);
const payloadTranslations = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as YandexPriceClub['zones'][number]['translations'] : undefined);

/** The zone's hardware fields from the page payload, so the route describes items as the script does. */
function payloadZoneSpecs(zone: Record<string, unknown>): YandexZoneSpecs {
  const specs: YandexZoneSpecs = {};
  for (const field of YANDEX_ZONE_SPEC_TEXT_FIELDS) specs[field] = payloadText(zone[field]);
  for (const field of YANDEX_ZONE_SPEC_NUMBER_FIELDS) specs[field] = payloadNumber(zone[field]);
  return specs;
}

/**
 * The club's price list input from its published page (`get_public_showcase`),
 * the only data the public price-card route reads. The payload holds active
 * offers only, each list already in the page's order. Null when unpublished.
 */
export function yandexPriceClubFromShowcase(raw: unknown): { slug: string; club: YandexPriceClub } | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const slug = payloadText(data.slug);
  if (!slug) return null;
  return {
    slug,
    club: {
      clubName: payloadText(data.club_name) ?? undefined,
      logoUrl: payloadText(data.logo_url),
      zones: payloadRows(data.zones).flatMap((zone, index) => {
        const id = payloadText(zone.id);
        const name = payloadText(zone.name);
        return id && name ? [{
          id, name, kind: zone.kind === 'playstation' ? 'playstation' as const : 'pc' as const, translations: payloadTranslations(zone.translations),
          price_per_hour: payloadNumber(zone.price_per_hour), image_url: payloadText(zone.image_url), sort_order: index,
          ...payloadZoneSpecs(zone),
        }] : [];
      }),
      offers: payloadRows(data.offers).flatMap((offer, index) => {
        const id = payloadText(offer.id);
        const title = payloadText(offer.title);
        return id && title ? [{
          id, title, description: payloadText(offer.description), translations: payloadTranslations(offer.translations),
          price: payloadNumber(offer.price), time_window: payloadText(offer.time_window), is_active: true, sort_order: index,
        }] : [];
      }),
      games: payloadRows(data.games).flatMap((game, index) => {
        const id = payloadText(game.id);
        const title = payloadText(game.title);
        return id && title ? [{ id, title, image_url: payloadText(game.image_url), sort_order: index }] : [];
      }),
    },
  };
}
