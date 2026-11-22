import 'server-only';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { landingBrandSlug, publicSiteOrigin, readPublicSiteConfig } from '@/lib/publicSite';
import { brandLogoUrl, logoIcons, type PublicBrand, type PublicShowcase } from '@/lib/showcase';
import { languageAlternates, localizedPath, openGraphLocale, snippetText } from '@/lib/seo';
import { isSupportedLocale, DEFAULT_LOCALE } from '@/lib/locale';

const publicSite = readPublicSiteConfig(process.env);

/**
 * Search Console ownership proof for https://www.pixelgaming.uz/ (owner's
 * Google account). It is public by design; removing it un-verifies the site.
 */
const GOOGLE_SITE_VERIFICATION = 'h4RpBKMnoAxCba40mZP8PTUdNHT_6pnkdnFcUO2nSRQ';

/** The indexed site address: the configured public host, else the host this request came in on. */
export async function siteOrigin(): Promise<string> {
  const configured = publicSiteOrigin(publicSite);
  if (configured) return configured;
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000';
  const protocol = requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

/** The landing brand lives at "/"; any other brand at its own address. */
export function brandPath(slug: string): string {
  return slug === landingBrandSlug(publicSite) ? '/' : `/brand/${slug}`;
}

export const clubPath = (slug: string) => `/club/${slug}`;

/** What public pages share: indexable, a canonical address and the visitor's Open Graph locale. */
async function publicMetadata(input: { title: string; description: string | null; path: string; image?: string; icons?: Metadata['icons'] }): Promise<Metadata> {
  const appLocale = await getLocale();
  const locale = isSupportedLocale(appLocale) ? appLocale : DEFAULT_LOCALE;
  const description = input.description ?? undefined;
  const url = localizedPath(input.path, locale);
  return {
    title: input.title,
    description,
    robots: { index: true, follow: true },
    // Each language is its own indexable address, linked with hreflang.
    alternates: { canonical: url, languages: languageAlternates(input.path) },
    verification: { google: GOOGLE_SITE_VERIFICATION },
    openGraph: {
      title: input.title,
      description,
      url,
      siteName: 'Pixel Gaming',
      locale: openGraphLocale(locale),
      images: input.image ? [input.image] : undefined,
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title: input.title, description, images: input.image ? [input.image] : undefined },
    icons: input.icons,
  };
}

export async function brandMetadata(brand: PublicBrand): Promise<Metadata> {
  const t = await getTranslations('publicShowcase');
  return publicMetadata({
    title: t('seo.title', { name: brand.name }),
    description: snippetText(brand.tagline ?? t('defaultTagline')),
    path: brandPath(brand.slug),
    image: brand.hero_image_url ?? brand.clubs.find((club) => club.hero_image_url)?.hero_image_url ?? undefined,
    icons: logoIcons(brandLogoUrl(brand)),
  });
}

export async function clubMetadata(club: PublicShowcase): Promise<Metadata> {
  const t = await getTranslations('publicShowcase');
  return publicMetadata({
    title: t('seo.title', { name: club.club_name }),
    description: snippetText(club.tagline ?? club.headline ?? t('defaultTagline')),
    path: clubPath(club.slug),
    image: club.hero_image_url ?? club.games.find((game) => game.image_url)?.image_url ?? undefined,
    icons: logoIcons(club.logo_url),
  });
}

/** Indexable metadata for a plain public page such as the privacy policy. */
export async function plainPublicMetadata(title: string, description: string, path: string): Promise<Metadata> {
  return publicMetadata({ title, description: snippetText(description), path });
}
