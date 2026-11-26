import { LOGO_ICON_PATH } from '@/lib/logoIcon';
import type { ClubShowcase, ShowcaseBrand, ShowcaseGame, ShowcaseOffer, ShowcasePcZone, ShowcaseTranslations, ShowcaseZoneKind } from '@/types';
import { formatCurrencyInput, formatPhone, normalizePhone, parseCurrencyInput } from './formatters';
import { APP_TIME_ZONE } from './utils';

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

/** An absolute http(s) URL, or null for a blank or unusable value. */
export function normalizeExternalUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  // "https:///a/b" would parse as the host "a", so a site path is never a link.
  if (!trimmed || trimmed.startsWith('/')) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const TELEGRAM_HOSTS = new Set(['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me']);

/** "@gameclub" or "t.me/gameclub" → https://t.me/gameclub; a link to any other site → null. */
export function normalizeTelegramUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const normalized = normalizeExternalUrl(trimmed.startsWith('@') ? `t.me/${trimmed.slice(1)}` : trimmed);
  if (!normalized) return null;
  const url = new URL(normalized);
  return TELEGRAM_HOSTS.has(url.hostname) && url.pathname.length > 1 ? normalized : null;
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

const YANDEX_MAPS_HOST = /^(?:www\.)?yandex\.(?:uz|ru|com|kz|by)$/;

/**
 * A Yandex Maps place link (e.g. yandex.uz/maps/org/club/123/), or null for
 * anything else. Matches the club_showcases_yandex_maps_url check in migration 140.
 */
export function normalizeYandexMapsUrl(value: string | null | undefined): string | null {
  const url = normalizeExternalUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  if (!YANDEX_MAPS_HOST.test(parsed.hostname) || !parsed.pathname.startsWith('/maps/')) return null;
  parsed.protocol = 'https:';
  return parsed.toString();
}

/** Matches the *_email_format checks in migration 104. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A trimmed, lower-cased email address, or null when blank or malformed. */
/**
 * A Google Maps place link ("maps.app.goo.gl/…", "google.com/maps/place/…"),
 * or null. Kept in step with the club_showcases_google_maps_url constraint.
 */
export function normalizeGoogleMapsUrl(value: string | null | undefined): string | null {
  const url = normalizeExternalUrl(value);
  if (!url || !url.startsWith('https://')) return null;
  return /^https:\/\/(maps\.app\.goo\.gl\/|goo\.gl\/maps\/|g\.page\/|(maps\.|www\.)?google\.(com|[a-z]{2}|com?\.[a-z]{2})\/)/.test(url) ? url : null;
}

/** Everything a club can tick as "we have this"; the site translates and draws each key. */
export const SHOWCASE_AMENITIES = [
  'open_24_7', 'playstation', 'vip_zone', 'night_packages', 'food', 'drinks',
  'card_payment', 'wifi', 'air_conditioning', 'parking', 'tournaments', 'smoking_area',
] as const;
export type ShowcaseAmenity = (typeof SHOWCASE_AMENITIES)[number];

/** Known keys only, without repeats, in the catalogue's order. */
export function normalizeAmenities(value: unknown): ShowcaseAmenity[] {
  const chosen = new Set(Array.isArray(value) ? value : []);
  return SHOWCASE_AMENITIES.filter((amenity) => chosen.has(amenity));
}

/** Photos a club page can show; the database refuses more. */
export const SHOWCASE_GALLERY_LIMIT = 12;

/** Safe, distinct photo links, at most the gallery limit. */
export function normalizeGallery(value: unknown): string[] {
  const links = (Array.isArray(value) ? value : []).flatMap((item) => {
    const url = typeof item === 'string' ? normalizeExternalUrl(item) : null;
    return url ? [url] : [];
  });
  return [...new Set(links)].slice(0, SHOWCASE_GALLERY_LIMIT);
}

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
  yandex_maps_url: string;
  google_maps_url: string;
  /** A short name that tells the owner's clubs apart on the brand page. */
  branch: LocalizedText;
  landmark: LocalizedText;
  /** The address per language; `address` stays the single-language fallback. */
  address_localized: LocalizedText;
  amenities: ShowcaseAmenity[];
  gallery: string[];
  sort_order: string;
}

export type ShowcaseSettingsError =
  | 'slug_invalid'
  | 'google_maps_invalid'
  | 'sort_order_invalid'
  | 'telegram_invalid'
  | 'instagram_invalid'
  | 'youtube_invalid'
  | 'yandex_maps_invalid'
  | 'email_invalid'
  | 'image_invalid';

/** Shared checks for the optional contact links of a club or brand page; clubs have one Telegram link, brands a channel and a group. */
function validateContactLinks(form: { email: string; telegram_url?: string; telegram_channel_url?: string; telegram_group_url?: string; instagram_url: string; youtube_url: string; hero_image_url: string }): ShowcaseSettingsError | null {
  if ([form.telegram_url, form.telegram_channel_url, form.telegram_group_url].some((link) => link?.trim() && !normalizeTelegramUrl(link))) return 'telegram_invalid';
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
    phone: formatPhone(showcase?.phone),
    email: showcase?.email ?? '',
    opening_hours: showcase?.opening_hours ?? '',
    telegram_url: showcase?.telegram_url ?? '',
    instagram_url: showcase?.instagram_url ?? '',
    youtube_url: showcase?.youtube_url ?? '',
    yandex_maps_url: showcase?.yandex_maps_url ?? '',
    google_maps_url: showcase?.google_maps_url ?? '',
    branch: localizedFromRow(showcase?.translations, 'branch', null),
    landmark: localizedFromRow(showcase?.translations, 'landmark', null),
    address_localized: localizedFromRow(showcase?.translations, 'address', null),
    amenities: normalizeAmenities(showcase?.amenities),
    gallery: normalizeGallery(showcase?.gallery),
    sort_order: String(showcase?.sort_order ?? 0),
  };
}

export function validateShowcaseSettings(form: ShowcaseSettingsForm): ShowcaseSettingsError | null {
  if (!SHOWCASE_SLUG_PATTERN.test(form.slug)) return 'slug_invalid';
  if (!isSortOrder(form.sort_order)) return 'sort_order_invalid';
  if (form.yandex_maps_url.trim() && !normalizeYandexMapsUrl(form.yandex_maps_url)) return 'yandex_maps_invalid';
  if (form.google_maps_url.trim() && !normalizeGoogleMapsUrl(form.google_maps_url)) return 'google_maps_invalid';
  return validateContactLinks(form);
}

/** Validated form → club_showcases columns (club_id added by the caller). */
export function buildShowcaseSettingsPayload(form: ShowcaseSettingsForm) {
  return {
    slug: form.slug,
    is_published: form.is_published,
    headline: primaryText(form.headline),
    tagline: primaryText(form.tagline),
    translations: {
      headline: localizedPayload(form.headline),
      tagline: localizedPayload(form.tagline),
      branch: localizedPayload(form.branch),
      landmark: localizedPayload(form.landmark),
      address: localizedPayload(form.address_localized),
    },
    hero_image_url: normalizeExternalUrl(form.hero_image_url),
    address: optionalText(form.address),
    phone: normalizePhone(form.phone),
    email: normalizeEmail(form.email),
    opening_hours: optionalText(form.opening_hours),
    telegram_url: normalizeTelegramUrl(form.telegram_url),
    instagram_url: normalizeInstagramUrl(form.instagram_url),
    youtube_url: normalizeYoutubeUrl(form.youtube_url),
    yandex_maps_url: normalizeYandexMapsUrl(form.yandex_maps_url),
    google_maps_url: normalizeGoogleMapsUrl(form.google_maps_url),
    amenities: normalizeAmenities(form.amenities),
    gallery: normalizeGallery(form.gallery),
    sort_order: Number(form.sort_order.trim()),
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
  | 'console_required'
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
  name: LocalizedText;
  pc_count: string;
  console: string;
  controllers: string;
  cpu: string;
  gpu: string;
  ram: string;
  monitor: string;
  monitor_size_inches: string;
  monitor_refresh_hz: string;
  mouse: string;
  keyboard: string;
  headset: string;
  chair: string;
  /** What sets the zone apart ("2 private rooms of 5") and other equipment, per language. */
  peripherals: LocalizedText;
  price_per_hour: string;
  image_url: string;
  sort_order: string;
}

export const PLAYSTATION_MODELS = ['ps3', 'ps4', 'ps5'] as const;
export type PlaystationModel = (typeof PLAYSTATION_MODELS)[number];

const DEFAULT_PLAYSTATION_MODEL: PlaystationModel = 'ps5';
const DEFAULT_CONTROLLERS = '2';
const PLAYSTATION_PRESETS: Record<PlaystationModel, { console: string; image_url: string }> = {
  ps3: { console: 'PlayStation 3', image_url: '/playstation/ps3.svg' },
  ps4: { console: 'PlayStation 4', image_url: '/playstation/ps4.svg' },
  ps5: { console: 'PlayStation 5', image_url: '/playstation/ps5.svg' },
};
const presets = Object.values(PLAYSTATION_PRESETS);

/** The model behind a saved console name, including older free-text ones like "PS5 Pro". */
export function playstationModel(consoleName: string): PlaystationModel | null {
  const match = /(?:ps|playstation)\s*([345])/i.exec(consoleName);
  return match ? (`ps${match[1]}` as PlaystationModel) : null;
}

/** A blank name or picture, or one a preset filled in, follows the model; the club's own never does. */
function isUnsetName(name: LocalizedText) {
  return SHOWCASE_LANGUAGES.every((language) => !name[language].trim() || presets.some((preset) => preset.console === name[language].trim()));
}

function isUnsetImage(url: string) {
  return !url.trim() || presets.some((preset) => preset.image_url === url.trim());
}

/** Fills a zone from the chosen console, so an admin only needs the count and price. */
export function applyPlaystationModel(form: ShowcasePcZoneForm, model: PlaystationModel): ShowcasePcZoneForm {
  const preset = PLAYSTATION_PRESETS[model];
  return {
    ...form,
    console: preset.console,
    controllers: form.controllers.trim() || DEFAULT_CONTROLLERS,
    name: isUnsetName(form.name) ? { ru: preset.console, uz: preset.console, en: preset.console } : form.name,
    image_url: isUnsetImage(form.image_url) ? preset.image_url : form.image_url,
  };
}

/** Switching a zone's type brings in the console preset, or drops it when going back to computers. */
export function switchZoneKind(form: ShowcasePcZoneForm, kind: ShowcaseZoneKind): ShowcasePcZoneForm {
  if (kind === 'playstation') {
    return applyPlaystationModel({ ...form, kind }, playstationModel(form.console) ?? DEFAULT_PLAYSTATION_MODEL);
  }
  return {
    ...form,
    kind,
    name: isUnsetName(form.name) ? { ru: '', uz: '', en: '' } : form.name,
    image_url: isUnsetImage(form.image_url) ? '' : form.image_url,
  };
}

/** Stored zone picture: one of the built-in console images, or an external link. */
function zoneImageUrl(value: string): string | null {
  const trimmed = value.trim();
  return presets.some((preset) => preset.image_url === trimmed) ? trimmed : normalizeExternalUrl(trimmed);
}

export function showcasePcZoneForm(zone: ShowcasePcZone | null, nextSortOrder: number, kind: ShowcaseZoneKind = 'pc'): ShowcasePcZoneForm {
  const form = emptyOrSavedZoneForm(zone, nextSortOrder, kind);
  if (form.kind !== 'playstation') return form;
  const model = zone ? playstationModel(form.console) : DEFAULT_PLAYSTATION_MODEL;
  return model ? applyPlaystationModel(form, model) : form;
}

function emptyOrSavedZoneForm(zone: ShowcasePcZone | null, nextSortOrder: number, kind: ShowcaseZoneKind): ShowcasePcZoneForm {
  return {
    kind: zone?.kind ?? kind,
    name: localizedFromRow(zone?.translations, 'name', zone?.name),
    pc_count: String(zone?.pc_count ?? 1),
    console: zone?.console ?? '',
    controllers: zone?.controllers == null ? '' : String(zone.controllers),
    cpu: zone?.cpu ?? '',
    gpu: zone?.gpu ?? '',
    ram: zone?.ram ?? '',
    monitor: zone?.monitor ?? '',
    monitor_size_inches: zone?.monitor_size_inches == null ? '' : String(zone.monitor_size_inches),
    monitor_refresh_hz: zone?.monitor_refresh_hz == null ? '' : String(zone.monitor_refresh_hz),
    mouse: zone?.mouse ?? '',
    keyboard: zone?.keyboard ?? '',
    headset: zone?.headset ?? '',
    chair: zone?.chair ?? '',
    peripherals: localizedFromRow(zone?.translations, 'description', zone?.peripherals),
    price_per_hour: zone?.price_per_hour == null ? '' : formatCurrencyInput(zone.price_per_hour),
    image_url: zone?.image_url ?? '',
    sort_order: String(zone?.sort_order ?? nextSortOrder),
  };
}

export function validateShowcasePcZone(form: ShowcasePcZoneForm): ShowcaseItemError | null {
  if (!primaryText(form.name)) return 'name_required';
  const count = Number(form.pc_count);
  if (!Number.isInteger(count) || count <= 0 || count > 1000) return 'pc_count_invalid';
  if (form.kind === 'playstation' && !playstationModel(form.console)) return 'console_required';
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
  if (form.image_url.trim() && !zoneImageUrl(form.image_url)) return 'image_invalid';
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
    name: primaryText(form.name) ?? '',
    translations: { name: localizedPayload(form.name), description: localizedPayload(form.peripherals) },
    pc_count: Number(form.pc_count),
    console: pc ? null : optionalText(form.console),
    controllers: !pc && form.controllers.trim() ? Number(form.controllers.trim()) : null,
    cpu: pcOnly(form.cpu),
    gpu: pcOnly(form.gpu),
    ram: pcOnly(form.ram),
    monitor: optionalText(form.monitor),
    monitor_size_inches: form.monitor_size_inches.trim() ? parseDecimalInput(form.monitor_size_inches) : null,
    monitor_refresh_hz: form.monitor_refresh_hz.trim() ? Number(form.monitor_refresh_hz.trim()) : null,
    mouse: pcOnly(form.mouse),
    keyboard: pcOnly(form.keyboard),
    headset: pcOnly(form.headset),
    chair: pcOnly(form.chair),
    peripherals: primaryText(form.peripherals),
    price_per_hour: form.price_per_hour.trim() ? parseCurrencyInput(form.price_per_hour) : null,
    image_url: zoneImageUrl(form.image_url),
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

const TITLE_SEPARATOR = /\s+[·•|—–-]\s+/;

/** "VIP · 3 часа" → the zone ("VIP") and the package ("3 часа"); no zone when the title has no separator. */
export function splitOfferTitle(title: string): { zone: string | null; length: string } {
  const parts = title.split(TITLE_SEPARATOR);
  if (parts.length < 2) return { zone: null, length: title };
  return { zone: parts[0], length: parts.slice(1).join(' · ') };
}

export interface PublicShowcase {
  club_name: string;
  logo_url: string | null;
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
  /** The club's own Yandex Maps place; the map menu searches the address without it. */
  yandex_maps_url: string | null;
  /** The club's own Google Maps place; the map link searches the address without it. */
  google_maps_url: string | null;
  /** A short name that tells the brand's clubs apart ("Chilanzar"). */
  branch_name: string | null;
  landmark: string | null;
  amenities: ShowcaseAmenity[];
  gallery: string[];
  /** The latest Google Maps rating the review digest recorded. */
  rating: { value: number; count: number } | null;
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
  return {
    headline: field('headline'), tagline: field('tagline'), title: field('title'), description: field('description'), name: field('name'),
    branch: field('branch'), landmark: field('landmark'), address: field('address'),
  };
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
  const translations = translationsOf(data);
  const ratingValue = finiteNumber(data.google_rating);
  const ratingCount = finiteNumber(data.google_review_count);

  return {
    club_name: clubName,
    logo_url: safeUrl(data.logo_url),
    slug,
    headline: pickLocalized(translationsOf(data).headline, locale, text(data.headline)),
    tagline: pickLocalized(translationsOf(data).tagline, locale, text(data.tagline)),
    hero_image_url: safeUrl(data.hero_image_url),
    address: pickLocalized(translations.address, locale, text(data.address)),
    phone: text(data.phone),
    email: typeof data.email === 'string' ? normalizeEmail(data.email) : null,
    opening_hours: text(data.opening_hours),
    telegram_url: safeUrl(data.telegram_url),
    instagram_url: safeUrl(data.instagram_url),
    youtube_url: safeUrl(data.youtube_url),
    yandex_maps_url: typeof data.yandex_maps_url === 'string' ? normalizeYandexMapsUrl(data.yandex_maps_url) : null,
    google_maps_url: typeof data.google_maps_url === 'string' ? normalizeGoogleMapsUrl(data.google_maps_url) : null,
    branch_name: pickLocalized(translations.branch, locale, null),
    landmark: pickLocalized(translations.landmark, locale, null),
    amenities: normalizeAmenities(data.amenities),
    gallery: normalizeGallery(data.gallery),
    rating: ratingValue !== null && ratingValue > 0 && ratingValue <= 5 && ratingCount !== null && ratingCount > 0
      ? { value: ratingValue, count: Math.round(ratingCount) }
      : null,
    games: list(data.games).flatMap((game) => {
      const title = text(game.title);
      const id = text(game.id);
      return title && id ? [{ id, title, genre: text(game.genre), image_url: safeUrl(game.image_url) }] : [];
    }),
    zones: list(data.zones).flatMap((zone) => {
      const name = pickLocalized(translationsOf(zone).name, locale, text(zone.name));
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
        monitor: text(zone.monitor),
        monitor_size_inches: positive(finiteNumber(zone.monitor_size_inches)),
        monitor_refresh_hz: positive(finiteNumber(zone.monitor_refresh_hz)),
        mouse: text(zone.mouse),
        keyboard: text(zone.keyboard),
        headset: text(zone.headset),
        chair: text(zone.chair),
        peripherals: pickLocalized(translationsOf(zone).description, locale, text(zone.peripherals)),
        price_per_hour: price !== null && price >= 0 ? price : null,
        // Built-in console pictures are site paths, not external links.
        image_url: typeof zone.image_url === 'string' ? zoneImageUrl(zone.image_url) : null,
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
/** `google` images are Business Profile posts and photos; Google downloads them from the public bucket. */
export type ShowcaseImageKind = 'game' | 'zone' | 'hero' | 'logo' | 'google' | 'gallery';

export function showcaseImagePath(clubId: string, kind: ShowcaseImageKind, fileName: string, random: string): string {
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
  telegram_channel_url: string | null;
  telegram_group_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  clubs: PublicShowcase[];
}

/** The brand's logo: the first club that has one. */
export function brandLogoUrl(brand: Pick<PublicBrand, 'clubs'>): string | null {
  return brand.clubs.find((club) => club.logo_url)?.logo_url ?? null;
}

/**
 * Browser-tab and home-screen icon of a public page; none without a logo.
 * Uploaded logos are square photos with a solid background, which shrink to
 * an unreadable dark square in a tab, so the tab icon is the round crop the
 * logo route draws. The home-screen icon keeps the original: iOS rounds it.
 */
export function logoIcons(logoUrl: string | null): { icon: string; apple: string } | undefined {
  return logoUrl ? { icon: `${LOGO_ICON_PATH}?src=${encodeURIComponent(logoUrl)}`, apple: logoUrl } : undefined;
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
    telegram_channel_url: safeUrl(data.telegram_channel_url),
    telegram_group_url: safeUrl(data.telegram_group_url),
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
  email: string;
  telegram_channel_url: string;
  telegram_group_url: string;
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
    email: brand?.email ?? '',
    telegram_channel_url: brand?.telegram_channel_url ?? '',
    telegram_group_url: brand?.telegram_group_url ?? '',
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

/**
 * Validated form → showcase_brands columns (owner_id added by the caller).
 * Phone, hours and booking Telegram belong to each club now, so saving clears
 * the brand-wide values that older versions stored.
 */
export function buildShowcaseBrandPayload(form: ShowcaseBrandForm) {
  return {
    slug: form.slug,
    name: form.name.trim(),
    tagline: primaryText(form.tagline),
    translations: { tagline: localizedPayload(form.tagline) },
    hero_image_url: normalizeExternalUrl(form.hero_image_url),
    phone: null,
    email: normalizeEmail(form.email),
    opening_hours: null,
    telegram_url: null,
    telegram_channel_url: normalizeTelegramUrl(form.telegram_channel_url),
    telegram_group_url: normalizeTelegramUrl(form.telegram_group_url),
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

/**
 * Links for a club's address in Yandex Maps and Google Maps; null without an
 * address. Yandex opens the club's saved place when there is one: its text
 * search guesses, landing on the building, another club or a "typo fixed" list.
 */
export function mapLinks(club: Pick<PublicShowcase, 'club_name' | 'address'> & { yandex_maps_url?: string | null; google_maps_url?: string | null }): MapLinks | null {
  const address = club.address?.trim();
  if (!address) return null;
  const query = encodeURIComponent(`${club.club_name}, ${address}`);
  return {
    yandex: normalizeYandexMapsUrl(club.yandex_maps_url) ?? `https://yandex.uz/maps/?text=${query}`,
    google: normalizeGoogleMapsUrl(club.google_maps_url) ?? `https://www.google.com/maps/search/?api=1&query=${query}`,
  };
}

export type OpenStatus = 'open' | 'closed';

/** Whether free-text hours mean open round the clock: "24/7", "круглосуточно", "kun-u tun". */
export function isRoundTheClock(hours: string | null | undefined): boolean {
  return /24\s*\/\s*7|круглосуточно|kun-u tun|24 soat|24 hours/i.test(hours ?? '');
}

const HOURS_RANGE = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/;

/** Minutes since midnight in the club's time zone. */
function minutesInTashkent(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value('hour') * 60 + value('minute');
}

/**
 * Whether a club is open now from its free-text hours: "24/7" or a daily
 * range like "10:00 – 02:00" (past midnight allowed). Null when the text
 * cannot be read, so no badge is shown rather than a wrong one.
 */
export function openStatus(hours: string | null | undefined, now: Date): OpenStatus | null {
  const text = hours?.trim();
  if (!text) return null;
  if (isRoundTheClock(text)) return 'open';
  const match = HOURS_RANGE.exec(text);
  if (!match) return null;
  const [opensH, opensM, closesH, closesM] = match.slice(1).map(Number);
  if (opensH > 24 || closesH > 24 || opensM > 59 || closesM > 59) return null;
  const opens = opensH * 60 + opensM;
  const closes = (closesH % 24) * 60 + closesM;
  if (opens === closes) return 'open';
  const current = minutesInTashkent(now);
  const open = opens < closes ? current >= opens && current < closes : current >= opens || current < closes;
  return open ? 'open' : 'closed';
}

/** How a club is told apart from the brand's other clubs: its branch name, else the club name. */
export function clubLabel(club: Pick<PublicShowcase, 'club_name' | 'branch_name'>): string {
  return club.branch_name ?? club.club_name;
}

/** One price of a zone for a package; a zone can charge differently by time of day. */
export interface PriceCell {
  price: number;
  time_window: string | null;
  /** What the package saves against paying each of its hours singly; null when unknown or nothing. */
  saving: number | null;
}

export interface PriceColumn {
  key: string;
  /** The package name ("2+1 hours"); null for the single-hour column. */
  label: string | null;
}

export interface PriceRow {
  zone: string;
  cells: Record<string, PriceCell[]>;
}

/** A club's price list as a zones × packages table, with offers that fit no zone listed apart. */
export interface PriceMatrix {
  columns: PriceColumn[];
  rows: PriceRow[];
  specials: PublicShowcaseOffer[];
}

export const HOURLY_COLUMN = 'hour';

/** Hours of play a package name promises: "2+1 hours" → 3, "7 hours" → 7, "Night package" → null. */
export function packageHours(label: string): number | null {
  const bonus = /^(\d+)\s*\+\s*(\d+)/.exec(label.trim());
  if (bonus) return Number(bonus[1]) + Number(bonus[2]);
  const plain = /^(\d+)(?![\d.,:])/.exec(label.trim());
  return plain ? Number(plain[1]) : null;
}

/**
 * Lays a club's offers out for comparison: one row per zone, one column per
 * package ("Zone · package" titles, the single hour first). A zone that only
 * has an hourly rate on its card (a PlayStation zone) still gets a row. Offers
 * without a zone in the title (combos) are returned as specials.
 */
export function buildPriceMatrix(offers: PublicShowcaseOffer[], zones: Array<Pick<PublicShowcaseZone, 'name' | 'price_per_hour'>>): PriceMatrix {
  const columns: PriceColumn[] = [];
  const rows: PriceRow[] = [];
  const specials: PublicShowcaseOffer[] = [];
  const rowOf = (zone: string) => {
    const found = rows.find((row) => row.zone.toLocaleLowerCase() === zone.toLocaleLowerCase());
    if (found) return found;
    const created: PriceRow = { zone, cells: {} };
    rows.push(created);
    return created;
  };

  for (const offer of offers) {
    const { zone, length } = splitOfferTitle(offer.title);
    if (!zone || offer.price === null) {
      specials.push(offer);
      continue;
    }
    const hourly = /^1(?!\d|[.,+])/.test(length);
    const key = hourly ? HOURLY_COLUMN : length.toLocaleLowerCase();
    if (!columns.some((column) => column.key === key)) columns.push({ key, label: hourly ? null : length });
    const row = rowOf(zone);
    (row.cells[key] ??= []).push({ price: offer.price, time_window: offer.time_window, saving: null });
  }

  for (const zone of zones) {
    if (zone.price_per_hour === null) continue;
    const row = rowOf(zone.name);
    if (!row.cells[HOURLY_COLUMN]?.length) row.cells[HOURLY_COLUMN] = [{ price: zone.price_per_hour, time_window: null, saving: null }];
  }
  if (rows.some((row) => row.cells[HOURLY_COLUMN]) && !columns.some((column) => column.key === HOURLY_COLUMN)) {
    columns.push({ key: HOURLY_COLUMN, label: null });
  }
  columns.sort((a, b) => Number(b.key === HOURLY_COLUMN) - Number(a.key === HOURLY_COLUMN));

  for (const row of rows) {
    const hourly = row.cells[HOURLY_COLUMN] ?? [];
    for (const column of columns) {
      const hours = column.label ? packageHours(column.label) : null;
      if (!hours) continue;
      for (const cell of row.cells[column.key] ?? []) {
        // The hour rate of the same time of day, or the zone's only hour rate.
        const rate = hourly.find((hour) => hour.time_window === cell.time_window) ?? (hourly.length === 1 ? hourly[0] : null);
        const saving = rate ? rate.price * hours - cell.price : 0;
        cell.saving = saving > 0 ? saving : null;
      }
    }
  }
  return { columns, rows, specials };
}

/** One package of a zone on a phone card. */
export interface ZonePriceLine {
  key: string;
  /** The package name; null for the single hour. */
  label: string | null;
  /** The line's prices under the card's time-of-day columns, null where it has none; null when it does not fit them. */
  slots: Array<PriceCell | null> | null;
  cells: PriceCell[];
}

/** A zone's prices laid out for a narrow screen. */
export interface ZonePriceCard {
  /** Times of day the zone charges differently by, as column heads; empty when it has one rate. */
  windows: string[];
  lines: ZonePriceLine[];
}

/**
 * A zone's row of the price table as a phone card. A zone with a day and a
 * night hour rate gets those times as columns, so each package reads across
 * instead of stacking; a package sold at some other time keeps its own time.
 */
export function zonePriceCard(row: PriceRow, columns: PriceColumn[]): ZonePriceCard {
  const hourly = (row.cells[HOURLY_COLUMN] ?? []).flatMap((cell) => (cell.time_window ? [cell.time_window] : []));
  const windows = hourly.length > 1 && hourly.length === row.cells[HOURLY_COLUMN].length && new Set(hourly).size === hourly.length
    ? hourly
    : [];
  const lines = columns.flatMap((column): ZonePriceLine[] => {
    const cells = row.cells[column.key] ?? [];
    if (cells.length === 0) return [];
    const times = cells.map((cell) => cell.time_window);
    const fits = windows.length > 0 && new Set(times).size === times.length && times.every((time) => time !== null && windows.includes(time));
    return [{
      key: column.key,
      label: column.label,
      slots: fits ? windows.map((time) => cells.find((cell) => cell.time_window === time) ?? null) : null,
      cells,
    }];
  });
  return { windows, lines };
}

/**
 * The embeddable Yandex map of a club's own place, from its "…/maps/org/<name>/<id>/"
 * link; null for any other link, where there is no place to show.
 */
export function yandexMapWidgetUrl(yandexMapsUrl: string | null | undefined): string | null {
  const id = /\/maps\/org\/[^/]+\/(\d+)/.exec(normalizeYandexMapsUrl(yandexMapsUrl) ?? '')?.[1];
  return id ? `https://yandex.uz/map-widget/v1/?oid=${id}&ol=biz&z=16` : null;
}

/**
 * A Telegram link that opens the chat with the message already typed. Only a
 * plain "t.me/<username>" link takes a draft; any other link is returned as it is.
 */
export function telegramDraftUrl(telegramUrl: string, message: string): string {
  return /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{3,}$/.test(telegramUrl)
    ? `${telegramUrl}?text=${encodeURIComponent(message)}`
    : telegramUrl;
}

/** Start times a visitor can ask for: every hour left today (from the next full hour), or all of tomorrow. */
export function bookingTimeSlots(now: Date, day: 'today' | 'tomorrow'): string[] {
  const first = day === 'today' ? Math.floor(minutesInTashkent(now) / 60) + 1 : 0;
  return Array.from({ length: Math.max(0, 24 - first) }, (_, index) => `${String(first + index).padStart(2, '0')}:00`);
}
