import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { LOCALE_HEADER, resolveRequestLocale } from '@/lib/locale';

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  // A public page's ?lang= address wins, then a language picked with the
  // switcher (locale cookie), then the device language; see src/lib/locale.ts.
  const locale = resolveRequestLocale(cookieStore.get('locale')?.value, headerStore.get('accept-language'), headerStore.get(LOCALE_HEADER));
  return {
    locale,
    timeZone: 'Asia/Tashkent',
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
