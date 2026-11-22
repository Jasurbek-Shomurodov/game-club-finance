/**
 * Search-engine data for the public site: meta descriptions, robots rules and
 * schema.org JSON-LD for the brand and its clubs. Pure, so the pages only
 * pass in what they already loaded.
 */
import { DEFAULT_LOCALE, LOCALE_PARAM, SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/locale';
import { isRoundTheClock, lowestHourlyPrice, type PublicBrand, type PublicShowcase } from '@/lib/showcase';

/** Google shows about this many characters of a description. */
const DESCRIPTION_LIMIT = 160;

/** Every club is in Tashkent (the app's time zone); schema.org wants the city and country apart from the street. */
const CLUB_LOCALITY = 'Tashkent';
const CLUB_COUNTRY = 'UZ';

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOURS_RANGE = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/;
// Emoji and pictographs read as noise in a search snippet.
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

type JsonLd = Record<string, unknown>;

/** One line of plain text, cut at a word boundary to fit a search snippet. */
export function snippetText(value: string | null | undefined, limit = DESCRIPTION_LIMIT): string | null {
  const text = (value ?? '').replace(PICTOGRAPHS, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

/** schema.org opening hours from the free-text hours: "24/7" or a daily "10:00 – 02:00". */
export function openingHoursSpecification(hours: string | null | undefined): JsonLd[] | undefined {
  const text = hours?.trim();
  if (!text) return undefined;
  if (isRoundTheClock(text)) {
    return [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ALL_DAYS, opens: '00:00', closes: '23:59' }];
  }
  const match = HOURS_RANGE.exec(text);
  if (!match) return undefined;
  const [opensH, opensM, closesH, closesM] = match.slice(1).map(Number);
  if (opensH > 24 || closesH > 24 || opensM > 59 || closesM > 59) return undefined;
  const time = (hour: number, minute: number) => `${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ALL_DAYS, opens: time(opensH, opensM), closes: time(closesH, closesM) }];
}

/** "10 000–50 000 UZS" from the zone prices, for priceRange. */
function priceRange(club: Pick<PublicShowcase, 'zones'>): string | undefined {
  const prices = club.zones.map((zone) => zone.price_per_hour).filter((price): price is number => price !== null && price > 0);
  if (!prices.length) return undefined;
  const format = (value: number) => Math.round(value).toLocaleString('en-US').replace(/,/g, ' ');
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high ? `${format(low)} UZS` : `${format(low)}–${format(high)} UZS`;
}

const compact = (record: JsonLd): JsonLd =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)));

const links = (...values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))];

/** A club as a schema.org local business: what Google uses for the map pack and rich results. */
export function clubJsonLd(club: PublicShowcase, url: string, brand?: { name: string; url: string }): JsonLd {
  const pcs = club.zones.filter((zone) => zone.kind === 'pc').reduce((sum, zone) => sum + zone.pc_count, 0);
  const consoles = club.zones.filter((zone) => zone.kind === 'playstation').reduce((sum, zone) => sum + zone.pc_count, 0);
  const lowest = lowestHourlyPrice(club.zones);
  return compact({
    '@type': ['EntertainmentBusiness', 'InternetCafe'],
    '@id': `${url}#club`,
    name: club.club_name,
    description: snippetText(club.tagline, 300) ?? undefined,
    url,
    image: links(club.hero_image_url, ...club.zones.map((zone) => (zone.image_url && /^https?:\/\//.test(zone.image_url) ? zone.image_url : null))).slice(0, 5),
    logo: club.logo_url ?? undefined,
    telephone: club.phone ?? undefined,
    email: club.email ?? undefined,
    address: club.address
      ? { '@type': 'PostalAddress', streetAddress: club.address, addressLocality: CLUB_LOCALITY, addressCountry: CLUB_COUNTRY }
      : undefined,
    hasMap: club.yandex_maps_url ?? undefined,
    openingHoursSpecification: openingHoursSpecification(club.opening_hours),
    priceRange: priceRange(club),
    currenciesAccepted: 'UZS',
    amenityFeature: [
      pcs > 0 ? { '@type': 'LocationFeatureSpecification', name: 'Gaming PCs', value: pcs } : null,
      consoles > 0 ? { '@type': 'LocationFeatureSpecification', name: 'PlayStation consoles', value: consoles } : null,
    ].filter(Boolean),
    makesOffer: lowest !== null
      ? { '@type': 'Offer', name: 'Gaming per hour', price: lowest, priceCurrency: 'UZS', unitText: 'HOUR' }
      : undefined,
    sameAs: links(club.instagram_url, club.telegram_url, club.youtube_url, club.yandex_maps_url),
    parentOrganization: brand ? { '@type': 'Organization', name: brand.name, url: brand.url } : undefined,
  });
}

/** The club page's JSON-LD document. */
export function clubPageJsonLd(club: PublicShowcase, url: string): JsonLd {
  return { '@context': 'https://schema.org', ...clubJsonLd(club, url) };
}

/** The brand page: the organization, its website and every published club. */
export function brandPageJsonLd(brand: PublicBrand, url: string, clubUrl: (slug: string) => string, logoUrl: string | null): JsonLd {
  const organization = compact({
    '@type': 'Organization',
    '@id': `${url}#organization`,
    name: brand.name,
    description: snippetText(brand.tagline, 300) ?? undefined,
    url,
    logo: logoUrl ?? undefined,
    image: brand.hero_image_url ?? undefined,
    telephone: brand.phone ?? undefined,
    email: brand.email ?? undefined,
    sameAs: links(brand.instagram_url, brand.telegram_url, brand.telegram_channel_url, brand.youtube_url),
  });
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      { '@type': 'WebSite', '@id': `${url}#website`, name: brand.name, url, publisher: { '@id': `${url}#organization` } },
      ...brand.clubs.map((club) => clubJsonLd(club, clubUrl(club.slug), { name: brand.name, url })),
    ],
  };
}

/** JSON-LD as a script body; "<" is escaped so stored text can never close the tag. */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Open Graph locale for the app language. */
export function openGraphLocale(locale: string): string {
  return locale === 'uz' ? 'uz_UZ' : locale === 'en' ? 'en_US' : 'ru_RU';
}

/** A public page in one language: Russian (the default) has the plain address, the others "?lang=". */
export function localizedPath(path: string, locale: SupportedLocale): string {
  return locale === DEFAULT_LOCALE ? path : `${path}?${LOCALE_PARAM}=${locale}`;
}

/** hreflang alternates for a public page: every language plus x-default (Russian). */
export function languageAlternates(path: string): Record<string, string> {
  return {
    ...Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, localizedPath(path, locale)])),
    'x-default': path,
  };
}

/** schema.org FAQPage for questions shown on the page; answers must match the visible text. */
export function faqPageJsonLd(items: Array<{ question: string; answer: string }>): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}
