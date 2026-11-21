// /sitemap.xml — every page of the public site: the brand page, each published
// club and the privacy policy. Empty on the admin host.

import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isPublicHost, landingBrandSlug, publicSiteOrigin, readPublicSiteConfig } from '@/lib/publicSite';
import { fetchPublicBrand } from '@/lib/supabase/publicShowcase';

// The answer depends on the request host, so it cannot be built once.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const config = readPublicSiteConfig(process.env);
  const origin = publicSiteOrigin(config);
  if (!origin || !isPublicHost((await headers()).get('host'), config)) return [];
  const brand = await fetchPublicBrand(landingBrandSlug(config), 'ru');
  return [
    { url: `${origin}/`, changeFrequency: 'weekly', priority: 1 },
    ...(brand?.clubs ?? []).map((club) => ({ url: `${origin}/club/${club.slug}`, changeFrequency: 'weekly' as const, priority: 0.8 })),
    { url: `${origin}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
