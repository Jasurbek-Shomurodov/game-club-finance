// Route: /club/[slug] — public, no sign-in.

import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { ShowcaseView } from '@/components/showcase/ShowcaseView';
import { JsonLd } from '@/components/showcase/JsonLd';
import { clubPageJsonLd } from '@/lib/seo';
import { clubMetadata, clubPath, siteOrigin } from '@/lib/seoServer';
import { fetchPublicShowcase } from '@/lib/supabase/publicShowcase';

// The visitor's language picks the headline and description; cached per request.
const loadShowcase = cache(async (slug: string) => fetchPublicShowcase(decodeURIComponent(slug), await getLocale()));

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const showcase = await loadShowcase((await params).slug);
  if (!showcase) return { title: 'Game Club', robots: { index: false } };
  return clubMetadata(showcase);
}

export default async function PublicClubPage({ params }: PageProps) {
  const showcase = await loadShowcase((await params).slug);
  if (!showcase) notFound();
  const url = new URL(clubPath(showcase.slug), await siteOrigin()).toString();
  return (
    <>
      <JsonLd data={clubPageJsonLd(showcase, url)} />
      <ShowcaseView showcase={showcase} />
    </>
  );
}
