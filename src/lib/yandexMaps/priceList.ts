// The club's Yandex Maps price list ("Товары и услуги" in Yandex Business),
// built from the app: each zone's hourly price and every active package or
// offer. Yandex has no API for it; the YML this builds is uploaded by hand
// (docs/runbooks/yandex-maps-sync.md), and an upload replaces the whole list.
// Pure, so it is tested without the database.

import { formatCurrency } from '@/lib/formatters';
import { normalizeExternalUrl, packageHours, pickLocalized, splitOfferTitle } from '@/lib/showcase';
import type { ShowcaseOffer, ShowcasePcZone } from '@/types';

/** Yandex's two sections of the list; ids are the YML `categoryId`s. */
export const YANDEX_PRICE_CATEGORIES = {
  hourly: { id: '1', name: 'Игровое время' },
  offers: { id: '2', name: 'Пакеты и акции' },
} as const;
export type YandexPriceCategory = keyof typeof YANDEX_PRICE_CATEGORIES;

export interface YandexPriceClub {
  logoUrl: string | null;
  zones: Array<Pick<ShowcasePcZone, 'id' | 'name' | 'translations' | 'price_per_hour' | 'image_url' | 'sort_order'>>;
  offers: Array<Pick<ShowcaseOffer, 'id' | 'title' | 'description' | 'translations' | 'price' | 'time_window' | 'is_active' | 'sort_order'>>;
}

export interface YandexPriceItem {
  /** Stable across runs: Latin letters and digits, at most 20 characters (the YML offer id rule). */
  id: string;
  name: string;
  /** Whole UZS. */
  price: number;
  category: YandexPriceCategory;
  description: string | null;
  picture: string | null;
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

/** Every price on the club's Yandex Maps card, hourly prices first. */
export function buildYandexPriceItems(club: YandexPriceClub): YandexPriceList {
  const hourly: YandexPriceItem[] = [];
  const packages: YandexPriceItem[] = [];
  const skipped: YandexSkippedItem[] = [];
  const logo = normalizeExternalUrl(club.logoUrl);
  const zones = bySortOrder(club.zones).map((zone) => ({
    zone,
    names: [zone.name, ...Object.values(zone.translations?.name ?? {})].filter((name): name is string => Boolean(name?.trim())),
    label: pickLocalized(zone.translations?.name, 'ru', zone.name) ?? zone.name,
    picture: normalizeExternalUrl(zone.image_url),
  }));
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
    const split = splitOfferTitle(offer.title).zone ? splitOfferTitle(offer.title) : splitOfferTitle(title);
    const zone = split.zone ? zones.find((candidate) => candidate.names.some((zoneName) => sameName(zoneName, split.zone!))) : undefined;
    if (zone && packageHours(split.length) === 1) zonesWithHourPackage.add(zone.zone.id);
    packages.push({ id: yandexItemId('offer', offer.id), name, price, category: 'offers', description, picture: zone?.picture ?? logo });
  }

  for (const { zone, label, picture } of zones) {
    if (zonesWithHourPackage.has(zone.id)) {
      skipped.push({ kind: 'zone', id: zone.id, name: label, reason: 'hourly_offer' });
      continue;
    }
    const price = wholePrice(zone.price_per_hour);
    if (!price) {
      skipped.push({ kind: 'zone', id: zone.id, name: label, reason: 'no_price' });
      continue;
    }
    hourly.push({ id: yandexItemId('zone', zone.id), name: `Игровой час — ${label}`, price, category: 'hourly', description: null, picture: picture ?? logo });
  }

  return { items: uniqueNames([...hourly, ...packages]), skipped };
}

/** Characters XML 1.0 does not allow at all (control characters, lone surrogates), even escaped. */
const XML_INVALID = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

const escapeXml = (value: string) => value.replace(XML_INVALID, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

/** The list as YML, in the shape of Yandex's own template (`/sprav/templates/price-list-template.xml`). */
export function buildYandexYml(items: readonly YandexPriceItem[], { clubName }: { clubName: string }): string {
  const categories = (Object.keys(YANDEX_PRICE_CATEGORIES) as YandexPriceCategory[])
    .filter((key) => items.some((item) => item.category === key))
    .map((key) => `      <category id="${YANDEX_PRICE_CATEGORIES[key].id}">${escapeXml(YANDEX_PRICE_CATEGORIES[key].name)}</category>`);
  const offers = items.map((item) => [
    `      <offer id="${escapeXml(item.id)}">`,
    `        <name>${escapeXml(item.name)}</name>`,
    `        <price>${item.price}</price>`,
    '        <currencyId>UZS</currencyId>',
    `        <categoryId>${YANDEX_PRICE_CATEGORIES[item.category].id}</categoryId>`,
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

export interface YandexPriceDiff {
  added: YandexPriceItem[];
  removed: YandexPriceSnapshotItem[];
  changed: YandexPriceChange[];
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
  const removed = current.filter((item) => !nextNames.has(normalizePriceName(item.name)));
  return { added, removed, changed };
}

const sum = (price: number | null) => (price === null ? 'без цены' : `${formatCurrency(price)} сум`);

/** The diff as lines for the owner to read before the upload. */
export function formatPriceDiff(diff: YandexPriceDiff): string[] {
  if (!diff.added.length && !diff.removed.length && !diff.changed.length) return ['Без изменений: на карточке уже этот прайс-лист.'];
  return [
    ...diff.added.map((item) => `+ ${item.name}: ${sum(item.price)}`),
    ...diff.removed.map((item) => `− ${item.name}: ${sum(item.price)}`),
    ...diff.changed.map((change) => `~ ${change.name}: ${change.fields.map((field) => (field === 'price'
      ? `${sum(change.before.price)} → ${sum(change.after.price)}`
      : 'описание')).join(', ')}`),
  ];
}
