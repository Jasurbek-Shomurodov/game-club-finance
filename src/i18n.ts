import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { resolveRequestLocale } from '@/lib/locale';

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  // A language picked with the switcher (locale cookie) wins; otherwise the
  // device language from Accept-Language, see src/lib/locale.ts.
  const locale = resolveRequestLocale(cookieStore.get('locale')?.value, headerStore.get('accept-language'));
  return {
    locale,
    timeZone: 'Asia/Tashkent',
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
