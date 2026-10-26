import type { ClubShowcase, ShowcaseGame, ShowcasePcZone } from '@/types';
import { formatCurrencyInput, parseCurrencyInput } from './formatters';

/** Matches the club_showcases_slug_format check in migration 098. */
export const SHOWCASE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

/** A URL-safe public address derived from a club name: "Game Zone №1" → "game-zone-1". */
export function slugifyClubName(name: string): string {
  const latin = [...name.toLowerCase().replace(/№/g, ' ')].map((char) => CYRILLIC_TO_LATIN[char] ?? char).join('');
  return latin
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function normalizeSlugInput(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').slice(0, 40);
}

const optionalText = (value: string) => value.trim() || null;

/** An absolute http(s) URL, or null for a blank or unusable value. */
export function normalizeExternalUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** "@gameclub" or "t.me/gameclub" → https://t.me/gameclub. */
export function normalizeTelegramUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('@')) return normalizeExternalUrl(`t.me/${trimmed.slice(1)}`);
  return normalizeExternalUrl(trimmed);
}

/** "@gameclub" → https://instagram.com/gameclub. */
export function normalizeInstagramUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('@')) return normalizeExternalUrl(`instagram.com/${trimmed.slice(1)}`);
  return normalizeExternalUrl(trimmed);
}

/** Digits and a leading plus only, for a tel: link. */
export function telHref(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return digits && digits.replace('+', '').length >= 5 ? `tel:${digits}` : null;
}

export interface ShowcaseSettingsForm {
  slug: string;
  is_published: boolean;
  headline: string;
  tagline: string;
  hero_image_url: string;
  address: string;
  phone: string;
  opening_hours: string;
  telegram_url: string;
  instagram_url: string;
}

export type ShowcaseSettingsError = 'slug_invalid' | 'telegram_invalid' | 'instagram_invalid' | 'image_invalid';

export function showcaseSettingsForm(showcase: ClubShowcase | null, clubName: string): ShowcaseSettingsForm {
  return {
    slug: showcase?.slug ?? slugifyClubName(clubName),
    is_published: showcase?.is_published ?? false,
    headline: showcase?.headline ?? '',
    tagline: showcase?.tagline ?? '',
    hero_image_url: showcase?.hero_image_url ?? '',
    address: showcase?.address ?? '',
    phone: showcase?.phone ?? '',
    opening_hours: showcase?.opening_hours ?? '',
    telegram_url: showcase?.telegram_url ?? '',
    instagram_url: showcase?.instagram_url ?? '',
  };
}

export function validateShowcaseSettings(form: ShowcaseSettingsForm): ShowcaseSettingsError | null {
  if (!SHOWCASE_SLUG_PATTERN.test(form.slug)) return 'slug_invalid';
  if (form.telegram_url.trim() && !normalizeTelegramUrl(form.telegram_url)) return 'telegram_invalid';
  if (form.instagram_url.trim() && !normalizeInstagramUrl(form.instagram_url)) return 'instagram_invalid';
  if (form.hero_image_url.trim() && !normalizeExternalUrl(form.hero_image_url)) return 'image_invalid';
  return null;
}

/** Validated form → club_showcases columns (club_id added by the caller). */
export function buildShowcaseSettingsPayload(form: ShowcaseSettingsForm) {
  return {
    slug: form.slug,
    is_published: form.is_published,
    headline: optionalText(form.headline),
    tagline: optionalText(form.tagline),
    hero_image_url: normalizeExternalUrl(form.hero_image_url),
    address: optionalText(form.address),
    phone: optionalText(form.phone),
    opening_hours: optionalText(form.opening_hours),
    telegram_url: normalizeTelegramUrl(form.telegram_url),
    instagram_url: normalizeInstagramUrl(form.instagram_url),
  };
}

export interface ShowcaseGameForm {
  title: string;
  genre: string;
  image_url: string;
  sort_order: string;
}

export type ShowcaseItemError = 'title_required' | 'name_required' | 'pc_count_invalid' | 'image_invalid' | 'sort_order_invalid';

export function showcaseGameForm(game: ShowcaseGame | null, nextSortOrder: number): ShowcaseGameForm {
  return {
    title: game?.title ?? '',
    genre: game?.genre ?? '',
    image_url: game?.image_url ?? '',
    sort_order: String(game?.sort_order ?? nextSortOrder),
  };
}

const isSortOrder = (value: string) => /^-?\d{1,6}$/.test(value.trim());

export function validateShowcaseGame(form: ShowcaseGameForm): ShowcaseItemError | null {
  if (!form.title.trim()) return 'title_required';
  if (form.image_url.trim() && !normalizeExternalUrl(form.image_url)) return 'image_invalid';
  if (!isSortOrder(form.sort_order)) return 'sort_order_invalid';
  return null;
}

export function buildShowcaseGamePayload(form: ShowcaseGameForm) {
  return {
    title: form.title.trim(),
    genre: optionalText(form.genre),
    image_url: normalizeExternalUrl(form.image_url),
    sort_order: Number(form.sort_order.trim()),
  };
}

export interface ShowcasePcZoneForm {
  name: string;
  pc_count: string;
  cpu: string;
  gpu: string;
  ram: string;
  monitor: string;
  peripherals: string;
  price_per_hour: string;
  image_url: string;
  sort_order: string;
}

export function showcasePcZoneForm(zone: ShowcasePcZone | null, nextSortOrder: number): ShowcasePcZoneForm {
  return {
    name: zone?.name ?? '',
    pc_count: String(zone?.pc_count ?? 1),
    cpu: zone?.cpu ?? '',
    gpu: zone?.gpu ?? '',
    ram: zone?.ram ?? '',
    monitor: zone?.monitor ?? '',
    peripherals: zone?.peripherals ?? '',
    price_per_hour: zone?.price_per_hour == null ? '' : formatCurrencyInput(zone.price_per_hour),
    image_url: zone?.image_url ?? '',
    sort_order: String(zone?.sort_order ?? nextSortOrder),
  };
}

export function validateShowcasePcZone(form: ShowcasePcZoneForm): ShowcaseItemError | null {
  if (!form.name.trim()) return 'name_required';
  const count = Number(form.pc_count);
  if (!Number.isInteger(count) || count <= 0 || count > 1000) return 'pc_count_invalid';
  if (form.image_url.trim() && !normalizeExternalUrl(form.image_url)) return 'image_invalid';
  if (!isSortOrder(form.sort_order)) return 'sort_order_invalid';
  return null;
}

export function buildShowcasePcZonePayload(form: ShowcasePcZoneForm) {
  return {
    name: form.name.trim(),
    pc_count: Number(form.pc_count),
    cpu: optionalText(form.cpu),
    gpu: optionalText(form.gpu),
    ram: optionalText(form.ram),
    monitor: optionalText(form.monitor),
    peripherals: optionalText(form.peripherals),
    price_per_hour: form.price_per_hour.trim() ? parseCurrencyInput(form.price_per_hour) : null,
    image_url: normalizeExternalUrl(form.image_url),
    sort_order: Number(form.sort_order.trim()),
  };
}

/** The next sort position after every existing item. */
export function nextSortOrder(items: Array<{ sort_order: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.sort_order), 0) + 10;
}

export interface PublicShowcaseGame {
  id: string;
  title: string;
  genre: string | null;
  image_url: string | null;
}

export interface PublicShowcaseZone {
  id: string;
  name: string;
  pc_count: number;
  cpu: string | null;
  gpu: string | null;
  ram: string | null;
  monitor: string | null;
  peripherals: string | null;
  price_per_hour: number | null;
  image_url: string | null;
}

export interface PublicShowcase {
  club_name: string;
  slug: string;
  headline: string | null;
  tagline: string | null;
  hero_image_url: string | null;
  address: string | null;
  phone: string | null;
  opening_hours: string | null;
  telegram_url: string | null;
  instagram_url: string | null;
  games: PublicShowcaseGame[];
  zones: PublicShowcaseZone[];
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const safeUrl = (value: unknown) => (typeof value === 'string' ? normalizeExternalUrl(value) : null);
const finiteNumber = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The get_public_showcase payload, defensively typed: anything missing or
 * malformed becomes null, and only http(s) image and social links survive so
 * a stored javascript: URL can never reach an href or src.
 */
export function parsePublicShowcase(raw: unknown): PublicShowcase | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const clubName = text(data.club_name);
  const slug = text(data.slug);
  if (!clubName || !slug) return null;
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []);

  return {
    club_name: clubName,
    slug,
    headline: text(data.headline),
    tagline: text(data.tagline),
    hero_image_url: safeUrl(data.hero_image_url),
    address: text(data.address),
    phone: text(data.phone),
    opening_hours: text(data.opening_hours),
    telegram_url: safeUrl(data.telegram_url),
    instagram_url: safeUrl(data.instagram_url),
    games: list(data.games).flatMap((game) => {
      const title = text(game.title);
      const id = text(game.id);
      return title && id ? [{ id, title, genre: text(game.genre), image_url: safeUrl(game.image_url) }] : [];
    }),
    zones: list(data.zones).flatMap((zone) => {
      const name = text(zone.name);
      const id = text(zone.id);
      if (!name || !id) return [];
      const count = finiteNumber(zone.pc_count);
      const price = finiteNumber(zone.price_per_hour);
      return [{
        id,
        name,
        pc_count: count !== null && count > 0 ? Math.round(count) : 1,
        cpu: text(zone.cpu),
        gpu: text(zone.gpu),
        ram: text(zone.ram),
        monitor: text(zone.monitor),
        peripherals: text(zone.peripherals),
        price_per_hour: price !== null && price >= 0 ? price : null,
        image_url: safeUrl(zone.image_url),
      }];
    }),
  };
}

/** Total seats across every zone. */
export function totalPcCount(zones: Array<{ pc_count: number }>): number {
  return zones.reduce((sum, zone) => sum + zone.pc_count, 0);
}

/** Lowest hourly price among the zones that list one. */
export function lowestHourlyPrice(zones: Array<{ price_per_hour: number | null }>): number | null {
  const prices = zones.map((zone) => zone.price_per_hour).filter((price): price is number => price !== null);
  return prices.length ? Math.min(...prices) : null;
}

/** Storage object path for an uploaded image: "<club_id>/<kind>-<random>.<ext>". */
export function showcaseImagePath(clubId: string, kind: 'game' | 'zone' | 'hero', fileName: string, random: string): string {
  const extension = /\.([a-z0-9]{2,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? 'jpg';
  return `${clubId}/${kind}-${random}.${extension}`;
}
