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

/** A saved choice (the locale cookie) wins; otherwise the device language. */
export function resolveRequestLocale(cookieLocale: string | null | undefined, acceptLanguage: string | null | undefined): SupportedLocale {
  return isSupportedLocale(cookieLocale) ? cookieLocale : localeFromAcceptLanguage(acceptLanguage);
}
