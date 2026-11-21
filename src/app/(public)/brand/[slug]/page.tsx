// Route: /brand/[slug] — public, no sign-in.

import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { BrandView } from '@/components/showcase/BrandView';
import { BrandJsonLd } from '@/components/showcase/BrandJsonLd';
import { brandMetadata } from '@/lib/seoServer';
import { fetchPublicBrand } from '@/lib/supabase/publicShowcase';

// The visitor's language picks the headline and description; cached per request.
const loadBrand = cache(async (slug: string) => fetchPublicBrand(decodeURIComponent(slug), await getLocale()));

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const brand = await loadBrand((await params).slug);
  if (!brand) return { title: 'Game Club', robots: { index: false } };
  return brandMetadata(brand);
}

export default async function PublicBrandPage({ params }: PageProps) {
  const brand = await loadBrand((await params).slug);
  if (!brand) notFound();
  return (
    <>
      <BrandJsonLd brand={brand} />
      <BrandView brand={brand} />
    </>
  );
}
