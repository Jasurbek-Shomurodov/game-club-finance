/**
 * IndexNow: tells Bing and Yandex (and the other participating engines) that
 * public pages changed, so they recrawl within hours instead of days. The key
 * is public by design; search engines fetch it from KEY_PATH on the site to
 * confirm the ping came from the site's owner.
 */
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { localizedPath } from '@/lib/seo';

export const INDEXNOW_KEY = '848e92e7b8d30016abab661e38933d8c';
/** Served from public/indexnow-key.txt; listed in PUBLIC_PAGES so the public host serves it. */
export const INDEXNOW_KEY_PATH = '/indexnow-key.txt';
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/** Every language version of the home page and each published club. */
export function indexNowPayload(origin: string, clubSlugs: string[]) {
  const paths = ['/', ...clubSlugs.map((slug) => `/club/${slug}`)];
  return {
    host: new URL(origin).host,
    key: INDEXNOW_KEY,
    keyLocation: `${origin}${INDEXNOW_KEY_PATH}`,
    urlList: paths.flatMap((path) => SUPPORTED_LOCALES.map((locale) => `${origin}${localizedPath(path, locale)}`)),
  };
}
