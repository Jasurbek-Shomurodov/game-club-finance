// /robots.txt — the public site is open to search engines and points at its
// sitemap; the admin host (and any host that is not public) is closed.

import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isPublicHost, publicSiteOrigin, readPublicSiteConfig } from '@/lib/publicSite';

// The answer depends on the request host, so it cannot be built once.
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const config = readPublicSiteConfig(process.env);
  const origin = publicSiteOrigin(config);
  if (!origin || !isPublicHost((await headers()).get('host'), config)) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/'] },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
