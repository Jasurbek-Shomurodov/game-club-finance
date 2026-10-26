import type { ClubShowcase, ShowcaseBrand, ShowcaseGame, ShowcaseOffer, ShowcasePcZone, ShowcaseTranslations, ShowcaseZoneKind } from '@/types';
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

/** Every app language, in the order the editor shows them; Russian is the default. */
export const SHOWCASE_LANGUAGES = ['ru', 'uz', 'en'] as const;
export type ShowcaseLanguage = (typeof SHOWCASE_LANGUAGES)[number];
export type LocalizedText = Record<ShowcaseLanguage, string>;
type LocalizedField = keyof ShowcaseTranslations;

/** One field's text per language for the editor; a page saved before 101 shows its single text under Russian. */
export function localizedFromRow(translations: ShowcaseTranslations | null | undefined, field: LocalizedField, legacy: string | null | undefined): LocalizedText {
  const stored = translations?.[field] ?? {};
  const value = Object.fromEntries(SHOWCASE_LANGUAGES.map((language) => [language, stored[language] ?? ''])) as LocalizedText;
  if (SHOWCASE_LANGUAGES.every((language) => !value[language].trim()) && legacy) value.ru = legacy;
  return value;
}

/** Trimmed, non-empty languages only. */
function localizedPayload(value: LocalizedText): Partial<LocalizedText> {
  return Object.fromEntries(SHOWCASE_LANGUAGES.flatMap((language) => (value[language].trim() ? [[language, value[language].trim()]] : [])));
}

/** The single-language fallback column: the first filled language in default order. */
function primaryText(value: LocalizedText): string | null {
  return SHOWCASE_LANGUAGES.map((language) => value[language].trim()).find(Boolean) ?? null;
}

/** The visitor's language, then the other languages in default order, then the single-language column. */
export function pickLocalized(value: Partial<Record<string, unknown>> | null | undefined, locale: string, fallback: string | null): string | null {
  const order = [locale, ...SHOWCASE_LANGUAGES.filter((language) => language !== locale)];
  for (const language of order) {
    const candidate = value?.[language];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

/** The languages of a localized field that have no text yet. */
export function missingLanguages(value: LocalizedText): ShowcaseLanguage[] {
  return SHOWCASE_LANGUAGES.filter((language) => !value[language].trim());
}

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

/** "@pixelgaming" → https://youtube.com/@pixelgaming. */
export function normalizeYoutubeUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('@')) return normalizeExternalUrl(`youtube.com/${trimmed}`);
  return normalizeExternalUrl(trimmed);
}

/** Matches the *_email_format checks in migration 104. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A trimmed, lower-cased email address, or null when blank or malformed. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && EMAIL_PATTERN.test(trimmed) ? trimmed : null;
}

/** Digits and a leading plus only, for a tel: link. */
export function telHref(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return digits && digits.replace('+', '').length >= 5 ? `tel:${digits}` : null;
}

export interface ShowcaseSettingsForm {
  slug: string;
  is_published: boolean;
  headline: LocalizedText;
  tagline: LocalizedText;
  hero_image_url: string;
  address: string;
  phone: string;
  email: string;
  opening_hours: string;
  telegram_url: string;
  instagram_url: string;
  youtube_url: string;
}

export type ShowcaseSettingsError =
  | 'slug_invalid'
  | 'telegram_invalid'
  | 'instagram_invalid'
  | 'youtube_invalid'
  | 'email_invalid'
  | 'image_invalid';

/** Shared checks for the optional contact links of a club or brand page. */
function validateContactLinks(form: { email: string; telegram_url: string; instagram_url: string; youtube_url: string; hero_image_url: string }): ShowcaseSettingsError | null {
  if (form.telegram_url.trim() && !normalizeTelegramUrl(form.telegram_url)) return 'telegram_invalid';
  if (form.instagram_url.trim() && !normalizeInstagramUrl(form.instagram_url)) return 'instagram_invalid';
  if (form.youtube_url.trim() && !normalizeYoutubeUrl(form.youtube_url)) return 'youtube_invalid';
  if (form.email.trim() && !normalizeEmail(form.email)) return 'email_invalid';
  if (form.hero_image_url.trim() && !normalizeExternalUrl(form.hero_image_url)) return 'image_invalid';
  return null;
}

export function showcaseSettingsForm(showcase: ClubShowcase | null, clubName: string): ShowcaseSettingsForm {
  return {
    slug: showcase?.slug ?? slugifyClubName(clubName),
    is_published: showcase?.is_published ?? false,
    headline: localizedFromRow(showcase?.translations, 'headline', showcase?.headline),
    tagline: localizedFromRow(showcase?.translations, 'tagline', showcase?.tagline),
    hero_image_url: showcase?.hero_image_url ?? '',
    address: showcase?.address ?? '',
    phone: showcase?.phone ?? '',
    email: showcase?.email ?? '',
    opening_hours: showcase?.opening_hours ?? '',
    telegram_url: showcase?.telegram_url ?? '',
    instagram_url: showcase?.instagram_url ?? '',
    youtube_url: showcase?.youtube_url ?? '',
  };
}

export function validateShowcaseSettings(form: ShowcaseSettingsForm): ShowcaseSettingsError | null {
  if (!SHOWCASE_SLUG_PATTERN.test(form.slug)) return 'slug_invalid';
  return validateContactLinks(form);
}

/** Validated form → club_showcases columns (club_id added by the caller). */
export function buildShowcaseSettingsPayload(form: ShowcaseSettingsForm) {
  return {
    slug: form.slug,
    is_published: form.is_published,
    headline: primaryText(form.headline),
    tagline: primaryText(form.tagline),
    translations: { headline: localizedPayload(form.headline), tagline: localizedPayload(form.tagline) },
    hero_image_url: normalizeExternalUrl(form.hero_image_url),
    address: optionalText(form.address),
    phone: optionalText(form.phone),
    email: normalizeEmail(form.email),
    opening_hours: optionalText(form.opening_hours),
    telegram_url: normalizeTelegramUrl(form.telegram_url),
    instagram_url: normalizeInstagramUrl(form.instagram_url),
    youtube_url: normalizeYoutubeUrl(form.youtube_url),
  };
}

export interface ShowcaseGameForm {
  title: string;
  genre: string;
  image_url: string;
  sort_order: string;
}

export type ShowcaseItemError =
  | 'title_required'
  | 'name_required'
  | 'pc_count_invalid'
  | 'controllers_invalid'
  | 'monitor_size_invalid'
  | 'monitor_refresh_invalid'
  | 'image_invalid'
  | 'sort_order_invalid';

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
  kind: ShowcaseZoneKind;
  name: string;
  pc_count: string;
  console: string;
  controllers: string;
  cpu: string;
  gpu: string;
  ram: string;
  storage: string;
  monitor: string;
  monitor_size_inches: string;
  monitor_refresh_hz: string;
  mouse: string;
  keyboard: string;
  headset: string;
  chair: string;
  peripherals: string;
  price_per_hour: string;
  image_url: string;
  sort_order: string;
}

export function showcasePcZoneForm(zone: ShowcasePcZone | null, nextSortOrder: number, kind: ShowcaseZoneKind = 'pc'): ShowcasePcZoneForm {
  return {
    kind: zone?.kind ?? kind,
    name: zone?.name ?? '',
    pc_count: String(zone?.pc_count ?? 1),
    console: zone?.console ?? '',
    controllers: zone?.controllers == null ? '' : String(zone.controllers),
    cpu: zone?.cpu ?? '',
    gpu: zone?.gpu ?? '',
    ram: zone?.ram ?? '',
    storage: zone?.storage ?? '',
    monitor: zone?.monitor ?? '',
    monitor_size_inches: zone?.monitor_size_inches == null ? '' : String(zone.monitor_size_inches),
    monitor_refresh_hz: zone?.monitor_refresh_hz == null ? '' : String(zone.monitor_refresh_hz),
    mouse: zone?.mouse ?? '',
    keyboard: zone?.keyboard ?? '',
    headset: zone?.headset ?? '',
    chair: zone?.chair ?? '',
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
  if (form.kind === 'playstation' && form.controllers.trim()) {
    const controllers = Number(form.controllers.trim());
    if (!Number.isInteger(controllers) || controllers < 1 || controllers > 20) return 'controllers_invalid';
  }
  if (form.monitor_size_inches.trim()) {
    const size = parseDecimalInput(form.monitor_size_inches);
    if (size === null || size < 10 || size > 100) return 'monitor_size_invalid';
  }
  if (form.monitor_refresh_hz.trim()) {
    const hz = Number(form.monitor_refresh_hz.trim());
    if (!Number.isInteger(hz) || hz < 30 || hz > 1000) return 'monitor_refresh_invalid';
  }
  if (form.image_url.trim() && !normalizeExternalUrl(form.image_url)) return 'image_invalid';
  if (!isSortOrder(form.sort_order)) return 'sort_order_invalid';
  return null;
}

/**
 * Validated form → showcase_pc_zones columns. Fields the other kind uses are
 * cleared, so switching a zone between PC and PlayStation leaves no stale specs.
 */
export function buildShowcasePcZonePayload(form: ShowcasePcZoneForm) {
  const pc = form.kind === 'pc';
  const pcOnly = (value: string) => (pc ? optionalText(value) : null);
  return {
    kind: form.kind,
    name: form.name.trim(),
    pc_count: Number(form.pc_count),
    console: pc ? null : optionalText(form.console),
    controllers: !pc && form.controllers.trim() ? Number(form.controllers.trim()) : null,
    cpu: pcOnly(form.cpu),
    gpu: pcOnly(form.gpu),
    ram: pcOnly(form.ram),
    storage: pcOnly(form.storage),
    monitor: optionalText(form.monitor),
    monitor_size_inches: form.monitor_size_inches.trim() ? parseDecimalInput(form.monitor_size_inches) : null,
    monitor_refresh_hz: form.monitor_refresh_hz.trim() ? Number(form.monitor_refresh_hz.trim()) : null,
    mouse: pcOnly(form.mouse),
    keyboard: pcOnly(form.keyboard),
    headset: optionalText(form.headset),
    chair: optionalText(form.chair),
    peripherals: optionalText(form.peripherals),
    price_per_hour: form.price_per_hour.trim() ? parseCurrencyInput(form.price_per_hour) : null,
    image_url: normalizeExternalUrl(form.image_url),
    sort_order: Number(form.sort_order.trim()),
  };
}

/** "27", "27.5" or "27,5" → 27.5; anything else → null. */
export function parseDecimalInput(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
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
  kind: ShowcaseZoneKind;
  name: string;
  /** Computers, or consoles in a PlayStation zone. */
  pc_count: number;
  console: string | null;
  controllers: number | null;
  cpu: string | null;
  gpu: string | null;
  ram: string | null;
  storage: string | null;
  monitor: string | null;
  monitor_size_inches: number | null;
  monitor_refresh_hz: number | null;
  mouse: string | null;
  keyboard: string | null;
  headset: string | null;
  chair: string | null;
  peripherals: string | null;
  price_per_hour: number | null;
  image_url: string | null;
}

export interface PublicShowcaseOffer {
  id: string;
  title: string;
  description: string | null;
  badge: string | null;
  price: number | null;
  time_window: string | null;
}

export interface PublicShowcase {
  club_name: string;
  slug: string;
  headline: string | null;
  tagline: string | null;
  hero_image_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  opening_hours: string | null;
  telegram_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  games: PublicShowcaseGame[];
  zones: PublicShowcaseZone[];
  offers: PublicShowcaseOffer[];
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const safeUrl = (value: unknown) => (typeof value === 'string' ? normalizeExternalUrl(value) : null);
const translationsOf = (data: Record<string, unknown>) => {
  const value = data.translations;
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const field = (name: string) => (record[name] && typeof record[name] === 'object' ? record[name] as Record<string, unknown> : {});
  return { headline: field('headline'), tagline: field('tagline'), title: field('title'), description: field('description') };
};
const positive = (value: number | null) => (value !== null && value > 0 ? value : null);
const finiteNumber = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The get_public_showcase payload, defensively typed: anything missing or
 * malformed becomes null, and only http(s) image and social links survive so
 * a stored javascript: URL can never reach an href or src.
 */
export function parsePublicShowcase(raw: unknown, locale = 'ru'): PublicShowcase | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const clubName = text(data.club_name);
  const slug = text(data.slug);
  if (!clubName || !slug) return null;
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []);

  return {
    club_name: clubName,
    slug,
    headline: pickLocalized(translationsOf(data).headline, locale, text(data.headline)),
    tagline: pickLocalized(translationsOf(data).tagline, locale, text(data.tagline)),
    hero_image_url: safeUrl(data.hero_image_url),
    address: text(data.address),
    phone: text(data.phone),
    email: typeof data.email === 'string' ? normalizeEmail(data.email) : null,
    opening_hours: text(data.opening_hours),
    telegram_url: safeUrl(data.telegram_url),
    instagram_url: safeUrl(data.instagram_url),
    youtube_url: safeUrl(data.youtube_url),
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
      const controllers = finiteNumber(zone.controllers);
      return [{
        id,
        kind: zone.kind === 'playstation' ? 'playstation' as const : 'pc' as const,
        name,
        pc_count: count !== null && count > 0 ? Math.round(count) : 1,
        console: text(zone.console),
        controllers: controllers !== null && controllers > 0 ? Math.round(controllers) : null,
        cpu: text(zone.cpu),
        gpu: text(zone.gpu),
        ram: text(zone.ram),
        storage: text(zone.storage),
        monitor: text(zone.monitor),
        monitor_size_inches: positive(finiteNumber(zone.monitor_size_inches)),
        monitor_refresh_hz: positive(finiteNumber(zone.monitor_refresh_hz)),
        mouse: text(zone.mouse),
        keyboard: text(zone.keyboard),
        headset: text(zone.headset),
        chair: text(zone.chair),
        peripherals: text(zone.peripherals),
        price_per_hour: price !== null && price >= 0 ? price : null,
        image_url: safeUrl(zone.image_url),
      }];
    }),
    offers: list(data.offers).flatMap((offer) => {
      const id = text(offer.id);
      const translations = translationsOf(offer);
      const title = pickLocalized(translations.title, locale, text(offer.title));
      if (!id || !title) return [];
      const price = finiteNumber(offer.price);
      return [{
        id,
        title,
        description: pickLocalized(translations.description, locale, text(offer.description)),
        badge: text(offer.badge),
        price: price !== null && price >= 0 ? price : null,
        time_window: text(offer.time_window),
      }];
    }),
  };
}

const isPc = (zone: { kind?: ShowcaseZoneKind }) => (zone.kind ?? 'pc') === 'pc';

/** Computers across every PC zone; PlayStation zones count consoles instead. */
export function totalPcCount(zones: Array<{ pc_count: number; kind?: ShowcaseZoneKind }>): number {
  return zones.filter(isPc).reduce((sum, zone) => sum + zone.pc_count, 0);
}

/** Consoles across every PlayStation zone. */
export function totalConsoleCount(zones: Array<{ pc_count: number; kind?: ShowcaseZoneKind }>): number {
  return zones.filter((zone) => !isPc(zone)).reduce((sum, zone) => sum + zone.pc_count, 0);
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

export interface PublicBrand {
  slug: string;
  name: string;
  tagline: string | null;
  hero_image_url: string | null;
  phone: string | null;
  email: string | null;
  opening_hours: string | null;
  telegram_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  clubs: PublicShowcase[];
}

/** The get_public_brand payload; clubs that fail to parse are dropped. */
export function parsePublicBrand(raw: unknown, locale = 'ru'): PublicBrand | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const slug = text(data.slug);
  const name = text(data.name);
  if (!slug || !name) return null;
  const clubs = Array.isArray(data.clubs) ? data.clubs.map((club) => parsePublicShowcase(club, locale)).filter((club): club is PublicShowcase => club !== null) : [];
  return {
    slug,
    name,
    tagline: pickLocalized(translationsOf(data).tagline, locale, text(data.tagline)),
    hero_image_url: safeUrl(data.hero_image_url),
    phone: text(data.phone),
    email: typeof data.email === 'string' ? normalizeEmail(data.email) : null,
    opening_hours: text(data.opening_hours),
    telegram_url: safeUrl(data.telegram_url),
    instagram_url: safeUrl(data.instagram_url),
    youtube_url: safeUrl(data.youtube_url),
    clubs,
  };
}

export interface ClubInsights {
  pcCount: number;
  consoleCount: number;
  zoneCount: number;
  gameCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  /** The graphics card of the most expensive zone that lists one, else of the first zone that does. */
  topGpu: string | null;
  /** The fastest refresh rate found in any monitor description ("27\" 240 Hz" → 240). */
  maxRefreshHz: number | null;
}

const REFRESH_PATTERN = /(\d{2,3})\s*(?:hz|гц|gs)/gi;

export function clubInsights(club: Pick<PublicShowcase, 'zones' | 'games'>): ClubInsights {
  const prices = club.zones.map((zone) => zone.price_per_hour).filter((price): price is number => price !== null);
  const pcZones = club.zones.filter(isPc);
  const withGpu = pcZones.filter((zone) => zone.gpu);
  const topZone = [...withGpu].sort((a, b) => (b.price_per_hour ?? -1) - (a.price_per_hour ?? -1))[0];
  // The structured refresh rate wins; older zones only have it inside the monitor text.
  const refreshRates = pcZones.flatMap((zone) => (zone.monitor_refresh_hz
    ? [zone.monitor_refresh_hz]
    : [...(zone.monitor ?? '').matchAll(REFRESH_PATTERN)].map((match) => Number(match[1]))));
  return {
    pcCount: totalPcCount(club.zones),
    consoleCount: totalConsoleCount(club.zones),
    zoneCount: club.zones.length,
    gameCount: club.games.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    topGpu: topZone?.gpu ?? null,
    maxRefreshHz: refreshRates.length ? Math.max(...refreshRates) : null,
  };
}

export interface BrandInsights {
  clubCount: number;
  pcCount: number;
  consoleCount: number;
  /** Distinct game titles across every club. */
  gameCount: number;
  minPrice: number | null;
}

export function brandInsights(brand: Pick<PublicBrand, 'clubs'>): BrandInsights {
  const titles = new Set(brand.clubs.flatMap((club) => club.games.map((game) => game.title.trim().toLowerCase())));
  return {
    clubCount: brand.clubs.length,
    pcCount: brand.clubs.reduce((sum, club) => sum + totalPcCount(club.zones), 0),
    consoleCount: brand.clubs.reduce((sum, club) => sum + totalConsoleCount(club.zones), 0),
    gameCount: titles.size,
    minPrice: lowestHourlyPrice(brand.clubs.flatMap((club) => club.zones)),
  };
}

export interface ShowcaseBrandForm {
  slug: string;
  name: string;
  tagline: LocalizedText;
  hero_image_url: string;
  phone: string;
  email: string;
  opening_hours: string;
  telegram_url: string;
  instagram_url: string;
  youtube_url: string;
  is_published: boolean;
}

export type ShowcaseBrandError = 'brand_name_required' | ShowcaseSettingsError;

export function showcaseBrandForm(brand: ShowcaseBrand | null): ShowcaseBrandForm {
  return {
    slug: brand?.slug ?? '',
    name: brand?.name ?? '',
    tagline: localizedFromRow(brand?.translations, 'tagline', brand?.tagline),
    hero_image_url: brand?.hero_image_url ?? '',
    phone: brand?.phone ?? '',
    email: brand?.email ?? '',
    opening_hours: brand?.opening_hours ?? '',
    telegram_url: brand?.telegram_url ?? '',
    instagram_url: brand?.instagram_url ?? '',
    youtube_url: brand?.youtube_url ?? '',
    is_published: brand?.is_published ?? false,
  };
}

export function validateShowcaseBrand(form: ShowcaseBrandForm): ShowcaseBrandError | null {
  if (!form.name.trim()) return 'brand_name_required';
  if (!SHOWCASE_SLUG_PATTERN.test(form.slug)) return 'slug_invalid';
  return validateContactLinks(form);
}

/** Validated form → showcase_brands columns (owner_id added by the caller). */
export function buildShowcaseBrandPayload(form: ShowcaseBrandForm) {
  return {
    slug: form.slug,
    name: form.name.trim(),
    tagline: primaryText(form.tagline),
    translations: { tagline: localizedPayload(form.tagline) },
    hero_image_url: normalizeExternalUrl(form.hero_image_url),
    phone: optionalText(form.phone),
    email: normalizeEmail(form.email),
    opening_hours: optionalText(form.opening_hours),
    telegram_url: normalizeTelegramUrl(form.telegram_url),
    instagram_url: normalizeInstagramUrl(form.instagram_url),
    youtube_url: normalizeYoutubeUrl(form.youtube_url),
    is_published: form.is_published,
  };
}

export interface ShowcaseOfferForm {
  title: LocalizedText;
  description: LocalizedText;
  badge: string;
  price: string;
  time_window: string;
  sort_order: string;
  is_active: boolean;
}

export type ShowcaseOfferError = 'offer_title_required' | 'sort_order_invalid';

export function showcaseOfferForm(offer: ShowcaseOffer | null, nextSortOrder: number): ShowcaseOfferForm {
  return {
    title: localizedFromRow(offer?.translations, 'title', offer?.title),
    description: localizedFromRow(offer?.translations, 'description', offer?.description),
    badge: offer?.badge ?? '',
    price: offer?.price == null ? '' : formatCurrencyInput(offer.price),
    time_window: offer?.time_window ?? '',
    sort_order: String(offer?.sort_order ?? nextSortOrder),
    is_active: offer?.is_active ?? true,
  };
}

export function validateShowcaseOffer(form: ShowcaseOfferForm): ShowcaseOfferError | null {
  if (!primaryText(form.title)) return 'offer_title_required';
  if (!isSortOrder(form.sort_order)) return 'sort_order_invalid';
  return null;
}

/** Validated form → showcase_offers columns (club_id added by the caller). */
export function buildShowcaseOfferPayload(form: ShowcaseOfferForm) {
  return {
    title: primaryText(form.title) ?? '',
    description: primaryText(form.description),
    translations: { title: localizedPayload(form.title), description: localizedPayload(form.description) },
    badge: optionalText(form.badge),
    price: form.price.trim() ? parseCurrencyInput(form.price) : null,
    time_window: optionalText(form.time_window),
    sort_order: Number(form.sort_order.trim()),
    is_active: form.is_active,
  };
}

export interface MapLinks {
  yandex: string;
  google: string;
}

/** Search links for a club's address in Yandex Maps and Google Maps; null without an address. */
export function mapLinks(club: Pick<PublicShowcase, 'club_name' | 'address'>): MapLinks | null {
  const address = club.address?.trim();
  if (!address) return null;
  const query = encodeURIComponent(`${club.club_name}, ${address}`);
  return {
    yandex: `https://yandex.uz/maps/?text=${query}`,
    google: `https://www.google.com/maps/search/?api=1&query=${query}`,
  };
}
