export const SUPPORTED_LOCALES = ['ru', 'uz', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Used when the browser sends no language preference at all. */
export const DEFAULT_LOCALE: SupportedLocale = 'ru';
/** Used when the browser asks only for languages the app does not have. */
export const FOREIGN_FALLBACK_LOCALE: SupportedLocale = 'en';

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value ?? '');
}

/**
 * The device language from an Accept-Language header, best match first:
 * "uz-Latn-UZ,uz;q=0.9,ru;q=0.8" → "uz". Regional variants match their base
 * language; q=0 entries are refused.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): SupportedLocale {
  if (!header?.trim()) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((param) => /^\s*q=([\d.]+)\s*$/.exec(param)?.[1]).find(Boolean);
      return { base: tag.trim().toLowerCase().split('-')[0], q: q === undefined ? 1 : Number(q), index };
    })
    .filter((entry) => entry.base && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked.map((entry) => entry.base).find(isSupportedLocale) ?? FOREIGN_FALLBACK_LOCALE;
}

/**
 * Public pages take the language from the address too ("/?lang=uz"), so
 * search engines can index each language: the proxy copies a valid `lang`
 * parameter into this request header.
 */
export const LOCALE_PARAM = 'lang';
export const LOCALE_HEADER = 'x-app-locale';

/** Set by the proxy on public pages, so the layout ships them only their own translations. */
export const SITE_SECTION_HEADER = 'x-site-section';
export const PUBLIC_SITE_SECTION = 'public';

/**
 * The translation namespaces the public pages' browser code reads. Server
 * components still see every message; this only trims what is sent to the
 * visitor (about 10 KB instead of the admin app's 230 KB).
 */
export const PUBLIC_MESSAGE_NAMESPACES = ['common', 'publicShowcase', 'privacy'] as const;

/** Only the named top-level namespaces of a message catalog. */
export function pickNamespaces<T extends Record<string, unknown>>(messages: T, namespaces: readonly string[]): Partial<T> {
  return Object.fromEntries(namespaces.filter((name) => name in messages).map((name) => [name, messages[name]])) as Partial<T>;
}

/**
 * The language in the address wins, then a saved choice (the locale cookie),
 * then the device language.
 */
export function resolveRequestLocale(
  cookieLocale: string | null | undefined,
  acceptLanguage: string | null | undefined,
  addressLocale?: string | null,
): SupportedLocale {
  if (isSupportedLocale(addressLocale)) return addressLocale;
  return isSupportedLocale(cookieLocale) ? cookieLocale : localeFromAcceptLanguage(acceptLanguage);
}
