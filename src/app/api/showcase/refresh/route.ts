import { revalidateTag } from 'next/cache';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PUBLIC_SHOWCASE_TAG, fetchPublicBrand } from '@/lib/supabase/publicShowcase';
import { INDEXNOW_ENDPOINT, indexNowPayload } from '@/lib/indexNow';
import { landingBrandSlug, publicSiteOrigin, readPublicSiteConfig } from '@/lib/publicSite';

/** Asks Bing and Yandex to recrawl the public pages. Best effort: a failure only means they find the change later. */
async function pingSearchEngines() {
  const config = readPublicSiteConfig(process.env);
  const origin = publicSiteOrigin(config);
  if (!origin) return;
  const brand = await fetchPublicBrand(landingBrandSlug(config), 'ru');
  await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(indexNowPayload(origin, brand?.clubs.map((club) => club.slug) ?? [])),
  }).catch(() => undefined);
}

/**
 * Clears the cached public page reads after an owner saves a showcase or brand
 * page, so the public site shows the change on the next visit instead of
 * within the cache's minute, and asks search engines to recrawl them (IndexNow).
 * Clearing is harmless, so any signed-in user may.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  revalidateTag(PUBLIC_SHOWCASE_TAG, { expire: 0 });
  after(pingSearchEngines);
  return new Response(null, { status: 204 });
}
