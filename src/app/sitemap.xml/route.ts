// /sitemap.xml — every page of the public site: the brand page, each published
// club and the privacy policy. Empty on the admin host.
// Written by hand rather than with Next's sitemap.ts so it can point browsers at
// /sitemap.xsl (otherwise they show "no style information associated with it").

import { headers } from 'next/headers';
import { isPublicHost, landingBrandSlug, publicSiteOrigin, readPublicSiteConfig } from '@/lib/publicSite';
import { languageAlternates } from '@/lib/seo';
import { fetchPublicBrand } from '@/lib/supabase/publicShowcase';
import { sitemapXml, type SitemapEntry } from '@/lib/sitemapXml';

// The answer depends on the request host, so it cannot be built once.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const config = readPublicSiteConfig(process.env);
  const origin = publicSiteOrigin(config);
  let entries: SitemapEntry[] = [];
  if (origin && isPublicHost((await headers()).get('host'), config)) {
    const brand = await fetchPublicBrand(landingBrandSlug(config), 'ru');
    // Each page lists its language versions (?lang=uz, ?lang=en) as hreflang alternates.
    const page = (path: string, changeFrequency: SitemapEntry['changeFrequency'], priority: number): SitemapEntry => ({
      url: `${origin}${path}`,
      changeFrequency,
      priority,
      alternates: Object.fromEntries(Object.entries(languageAlternates(path)).map(([lang, href]) => [lang, `${origin}${href}`])),
    });
    entries = [
      page('/', 'weekly', 1),
      ...(brand?.clubs ?? []).map((club) => page(`/club/${club.slug}`, 'weekly', 0.8)),
      page('/privacy', 'yearly', 0.2),
    ];
  }
  return new Response(sitemapXml(entries), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
