'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAppLocale } from './AppLocaleContext';

/**
 * Switching language swaps the client messages instantly, but text rendered
 * on the server (public pages pick club descriptions and offers by language
 * there) only follows after a refresh. Mount this on such pages; the locale
 * cookie is already set when the switch commits, so the refresh renders the
 * new language.
 */
export function LocaleServerRefresh() {
  const { locale } = useAppLocale();
  const router = useRouter();
  const rendered = useRef(locale);

  useEffect(() => {
    if (rendered.current === locale) return;
    rendered.current = locale;
    router.refresh();
  }, [locale, router]);

  return null;
}
