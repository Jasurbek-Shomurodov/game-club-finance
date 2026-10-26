// Route: /club/[slug] — public, no sign-in.

import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { ShowcaseView } from '@/components/showcase/ShowcaseView';
import { fetchPublicShowcase } from '@/lib/supabase/showcase';

const loadShowcase = cache((slug: string) => fetchPublicShowcase(decodeURIComponent(slug)));

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const showcase = await loadShowcase((await params).slug);
  if (!showcase) return { title: 'Game Club', robots: { index: false } };
  const title = showcase.headline ? `${showcase.club_name} — ${showcase.headline}` : showcase.club_name;
  const image = showcase.hero_image_url ?? showcase.games.find((game) => game.image_url)?.image_url ?? undefined;
  return {
    title,
    description: showcase.tagline ?? undefined,
    openGraph: { title, description: showcase.tagline ?? undefined, images: image ? [image] : undefined, type: 'website' },
  };
}

export default async function PublicClubPage({ params }: PageProps) {
  const showcase = await loadShowcase((await params).slug);
  if (!showcase) notFound();
  return <ShowcaseView showcase={showcase} />;
}
