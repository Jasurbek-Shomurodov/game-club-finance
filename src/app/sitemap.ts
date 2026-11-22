// /sitemap.xml — every page of the public site: the brand page, each published
// club and the privacy policy. Empty on the admin host.

import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isPublicHost, landingBrandSlug, publicSiteOrigin, readPublicSiteConfig } from '@/lib/publicSite';
import { languageAlternates } from '@/lib/seo';
import { fetchPublicBrand } from '@/lib/supabase/publicShowcase';

// The answer depends on the request host, so it cannot be built once.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const config = readPublicSiteConfig(process.env);
  const origin = publicSiteOrigin(config);
  if (!origin || !isPublicHost((await headers()).get('host'), config)) return [];
  const brand = await fetchPublicBrand(landingBrandSlug(config), 'ru');
  // Each page lists its language versions (?lang=uz, ?lang=en) as hreflang alternates.
  const page = (path: string, changeFrequency: 'weekly' | 'yearly', priority: number) => ({
    url: `${origin}${path}`,
    changeFrequency,
    priority,
    alternates: { languages: Object.fromEntries(Object.entries(languageAlternates(path)).map(([lang, href]) => [lang, `${origin}${href}`])) },
  });
  return [
    page('/', 'weekly', 1),
    ...(brand?.clubs ?? []).map((club) => page(`/club/${club.slug}`, 'weekly', 0.8)),
    page('/privacy', 'yearly', 0.2),
  ];
}
