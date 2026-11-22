import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicBrand, PublicShowcase } from '@/lib/showcase';

const requestHeaders = new Map<string, string>();
vi.mock('next/headers', () => ({ headers: async () => ({ get: (name: string) => requestHeaders.get(name) ?? null }) }));
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'uz',
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    key === 'seo.title' ? `${values?.name} — Toshkentdagi kompyuter klubi` : 'Default tagline',
}));

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value ?? '');
  return import('./seoServer');
}

const club = { club_name: 'Pixel Gaming', slug: 'pixel-game-club', tagline: null, headline: '🎮 Play', hero_image_url: null, logo_url: null, games: [{ image_url: 'https://cdn.example/game.jpg' }] } as unknown as PublicShowcase;
const brand = { slug: 'pixel-gaming', name: 'Pixel Gaming', tagline: null, hero_image_url: null, clubs: [club] } as unknown as PublicBrand;

describe('public page metadata', () => {
  beforeEach(() => {
    requestHeaders.clear();
    vi.unstubAllEnvs();
  });

  it('puts the landing brand at the root and other brands at their own address', async () => {
    const seo = await load({ PUBLIC_SITE_BRAND_SLUG: 'pixel-gaming' });
    expect(seo.brandPath('pixel-gaming')).toBe('/');
    expect(seo.brandPath('other')).toBe('/brand/other');
    expect(seo.clubPath('a')).toBe('/club/a');
  });

  it('uses the configured public origin, else the request host', async () => {
    expect(await (await load({ PUBLIC_SITE_HOSTS: 'pixelgaming.uz,www.pixelgaming.uz' })).siteOrigin()).toBe('https://www.pixelgaming.uz');
    requestHeaders.set('host', 'localhost:3000');
    expect(await (await load({ PUBLIC_SITE_HOSTS: '' })).siteOrigin()).toBe('http://localhost:3000');
  });

  it('makes brand, club and plain pages indexable with a canonical address', async () => {
    const seo = await load({ PUBLIC_SITE_BRAND_SLUG: 'pixel-gaming' });
    const brandMeta = await seo.brandMetadata(brand);
    expect(brandMeta).toMatchObject({ title: 'Pixel Gaming — Toshkentdagi kompyuter klubi', description: 'Default tagline', robots: { index: true }, alternates: { canonical: '/?lang=uz', languages: { ru: '/', uz: '/?lang=uz', en: '/?lang=en', 'x-default': '/' } }, verification: { google: expect.any(String) }, openGraph: { locale: 'uz_UZ' } });
    const clubMeta = await seo.clubMetadata(club);
    expect(clubMeta).toMatchObject({ description: 'Play', alternates: { canonical: '/club/pixel-game-club?lang=uz' }, openGraph: { images: ['https://cdn.example/game.jpg'] } });
    expect(await seo.plainPublicMetadata('Privacy', 'Intro', '/privacy')).toMatchObject({ alternates: { canonical: '/privacy?lang=uz' }, robots: { index: true } });
  });
});
