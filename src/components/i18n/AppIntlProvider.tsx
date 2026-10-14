'use client';

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { useCallback, useMemo, useRef, useState } from 'react';
import { setFormatterLocale } from '@/lib/formatters';
import {
  AppLocaleContext,
  isAppLocale,
  type AppLocale,
  type AppLocaleContextValue,
} from '@/components/i18n/AppLocaleContext';

// Only the server-chosen language ships with the page; the others are split
// into their own chunks and fetched the first time someone switches to them.
const loadMessages: Record<AppLocale, () => Promise<AbstractIntlMessages>> = {
  ru: () => import('@/messages/ru.json').then((module) => module.default),
  uz: () => import('@/messages/uz.json').then((module) => module.default),
  en: () => import('@/messages/en.json').then((module) => module.default),
};

export function AppIntlProvider({
  initialLocale,
  initialMessages,
  children,
}: {
  initialLocale: string;
  initialMessages: AbstractIntlMessages;
  children: React.ReactNode;
}) {
  // The server falls back to Russian for an unknown locale, so its messages are Russian then.
  const startLocale: AppLocale = isAppLocale(initialLocale) ? initialLocale : 'ru';
  const [current, setCurrent] = useState<{ locale: AppLocale; messages: AbstractIntlMessages }>(
    () => ({ locale: startLocale, messages: initialMessages }),
  );
  const loadedMessages = useRef<Partial<Record<AppLocale, AbstractIntlMessages>>>({ [startLocale]: initialMessages });
  const latestRequest = useRef(0);
  const { locale, messages } = current;

  setFormatterLocale(locale);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    const request = ++latestRequest.current;
    const cached = loadedMessages.current[nextLocale];
    const ready = cached ? Promise.resolve(cached) : loadMessages[nextLocale]();

    ready
      .then((nextMessages) => {
        loadedMessages.current[nextLocale] = nextMessages;
        // A later switch wins if the person clicked again while this loaded.
        if (request !== latestRequest.current) return;
        // Switch the locale and its messages together so no screen renders a mix.
        setFormatterLocale(nextLocale);
        setCurrent({ locale: nextLocale, messages: nextMessages });
        document.documentElement.lang = nextLocale;
        document.cookie = `locale=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
        document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
      })
      .catch((error) => {
        // Offline or a failed chunk: stay on the current language.
        console.error('Failed to load language', nextLocale, error);
      });
  }, []);

  const value = useMemo<AppLocaleContextValue>(
    () => ({ locale, setLocale }),
    [locale, setLocale],
  );

  return (
    <AppLocaleContext.Provider value={value}>
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Asia/Tashkent"
      >
        {children}
      </NextIntlClientProvider>
    </AppLocaleContext.Provider>
  );
}
