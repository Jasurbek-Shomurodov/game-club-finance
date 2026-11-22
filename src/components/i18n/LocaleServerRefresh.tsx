'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DEFAULT_LOCALE, LOCALE_PARAM } from '@/lib/locale';
import { useAppLocale } from './AppLocaleContext';

/**
 * Switching language swaps the client messages instantly, but text rendered
 * on the server (public pages pick club descriptions and offers by language
 * there) only follows after a refresh. Mount this on such pages; the locale
 * cookie is already set when the switch commits, so the refresh renders the
 * new language. A page opened at a language address ("?lang=uz") moves to the
 * new language's address instead, since the address outranks the cookie.
 */
export function LocaleServerRefresh() {
  const { locale } = useAppLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rendered = useRef(locale);

  useEffect(() => {
    if (rendered.current === locale) return;
    rendered.current = locale;
    if (!searchParams.has(LOCALE_PARAM)) {
      router.refresh();
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    if (locale === DEFAULT_LOCALE) params.delete(LOCALE_PARAM);
    else params.set(LOCALE_PARAM, locale);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [locale, pathname, router, searchParams]);

  return null;
}
