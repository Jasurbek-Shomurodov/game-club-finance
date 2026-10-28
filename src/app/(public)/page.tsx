// Route: / — the public landing page for everyone, signed in or not. It has
// no sign-in link; staff use the admin host, whose root opens the dashboard
// (see src/lib/publicSite.ts).

import type { Metadata } from 'next';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { BrandView } from '@/components/showcase/BrandView';
import { landingBrandSlug, readPublicSiteConfig } from '@/lib/publicSite';
import { fetchPublicBrand } from '@/lib/supabase/showcase';

const loadLandingBrand = cache(async () => fetchPublicBrand(landingBrandSlug(readPublicSiteConfig(process.env)), await getLocale()));

export async function generateMetadata(): Promise<Metadata> {
  const brand = await loadLandingBrand();
  if (!brand) return {};
  const image = brand.hero_image_url ?? brand.clubs.find((club) => club.hero_image_url)?.hero_image_url ?? undefined;
  return {
    title: brand.name,
    description: brand.tagline ?? undefined,
    openGraph: { title: brand.name, description: brand.tagline ?? undefined, images: image ? [image] : undefined, type: 'website' },
  };
}

export default async function LandingPage() {
  const brand = await loadLandingBrand();
  // Until the brand page is published there is nothing public to show; keep
  // the previous behaviour of opening the sign-in flow.
  if (!brand) redirect('/login');
  return <BrandView brand={brand} />;
}
