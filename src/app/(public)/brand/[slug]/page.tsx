// Route: /brand/[slug] — public, no sign-in.

import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { BrandView } from '@/components/showcase/BrandView';
import { brandLogoUrl, logoIcons } from '@/lib/showcase';
import { fetchPublicBrand } from '@/lib/supabase/showcase';

// The visitor's language picks the headline and description; cached per request.
const loadBrand = cache(async (slug: string) => fetchPublicBrand(decodeURIComponent(slug), await getLocale()));

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const brand = await loadBrand((await params).slug);
  if (!brand) return { title: 'Game Club', robots: { index: false } };
  const image = brand.hero_image_url ?? brand.clubs.find((club) => club.hero_image_url)?.hero_image_url ?? undefined;
  return {
    title: brand.name,
    description: brand.tagline ?? undefined,
    openGraph: { title: brand.name, description: brand.tagline ?? undefined, images: image ? [image] : undefined, type: 'website' },
    icons: logoIcons(brandLogoUrl(brand)),
  };
}

export default async function PublicBrandPage({ params }: PageProps) {
  const brand = await loadBrand((await params).slug);
  if (!brand) notFound();
  return <BrandView brand={brand} />;
}
