import { describe, expect, it } from 'vitest';
import type { PublicBrand, PublicShowcase } from '@/lib/showcase';
import { brandPageJsonLd, languageAlternates, localizedPath, clubPageJsonLd, openGraphLocale, openingHoursSpecification, serializeJsonLd, snippetText } from './seo';

const club: PublicShowcase = {
  club_name: 'Pixel Gaming',
  logo_url: 'https://cdn.example/logo.jpg',
  slug: 'pixel-game-club',
  headline: 'Your gaming home',
  tagline: '🎮 Powerful PCs\n\nand fast monitors',
  hero_image_url: 'https://cdn.example/hero.jpg',
  address: 'Matbuotchilar 17',
  phone: '+998 90 917 66 99',
  email: null,
  opening_hours: '24/7',
  telegram_url: 'https://t.me/pixel',
  instagram_url: 'https://instagram.com/pixel',
  youtube_url: null,
  yandex_maps_url: 'https://yandex.uz/maps/org/pixel/1/',
  games: [],
  zones: [
    { id: 'a', kind: 'pc', name: 'Standard', pc_count: 33, price_per_hour: 10000, image_url: null } as PublicShowcase['zones'][number],
    { id: 'b', kind: 'playstation', name: 'PS5', pc_count: 2, price_per_hour: 50000, image_url: '/playstation/ps5.png' } as PublicShowcase['zones'][number],
  ],
  offers: [],
};

describe('snippetText', () => {
  it('drops emoji and line breaks', () => {
    expect(snippetText(club.tagline)).toBe('Powerful PCs and fast monitors');
    expect(snippetText('  ')).toBeNull();
  });

  it('cuts long text at a word boundary', () => {
    const cut = snippetText('word '.repeat(60));
    expect(cut!.length).toBeLessThanOrEqual(160);
    expect(cut).toMatch(/word…$/);
  });
});

describe('openingHoursSpecification', () => {
  it('reads round-the-clock and daily ranges', () => {
    expect(openingHoursSpecification('24/7')?.[0]).toMatchObject({ opens: '00:00', closes: '23:59' });
    expect(openingHoursSpecification('10:00 – 02:00')?.[0]).toMatchObject({ opens: '10:00', closes: '02:00' });
    expect(openingHoursSpecification('by appointment')).toBeUndefined();
  });
});

describe('club JSON-LD', () => {
  it('describes the club as a local business', () => {
    const data = clubPageJsonLd(club, 'https://www.pixelgaming.uz/club/pixel-game-club');
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': ['EntertainmentBusiness', 'InternetCafe'],
      name: 'Pixel Gaming',
      telephone: '+998 90 917 66 99',
      address: { streetAddress: 'Matbuotchilar 17', addressLocality: 'Tashkent', addressCountry: 'UZ' },
      priceRange: '10 000–50 000 UZS',
      makesOffer: { price: 10000, priceCurrency: 'UZS' },
    });
    // Built-in console pictures are site paths, not absolute image URLs.
    expect(data.image).toEqual(['https://cdn.example/hero.jpg']);
    expect(data).not.toHaveProperty('email');
  });

  it('lists the organization, website and clubs for a brand', () => {
    const brand = { slug: 'pixel-gaming', name: 'Pixel Gaming', tagline: null, hero_image_url: null, phone: null, email: null, opening_hours: null, telegram_url: null, telegram_channel_url: null, telegram_group_url: null, instagram_url: null, youtube_url: null, clubs: [club] } satisfies PublicBrand;
    const data = brandPageJsonLd(brand, 'https://www.pixelgaming.uz/', (slug) => `https://www.pixelgaming.uz/club/${slug}`, null);
    const graph = data['@graph'] as Array<Record<string, unknown>>;
    expect(graph.map((node) => node['@type'])).toEqual(['Organization', 'WebSite', ['EntertainmentBusiness', 'InternetCafe']]);
    expect(graph[2]).toMatchObject({ url: 'https://www.pixelgaming.uz/club/pixel-game-club', parentOrganization: { name: 'Pixel Gaming' } });
  });
});

describe('serializeJsonLd', () => {
  it('cannot close the script tag', () => {
    expect(serializeJsonLd({ name: '</script><script>x' })).not.toContain('</script>');
  });
});

describe('openGraphLocale', () => {
  it('maps app languages', () => {
    expect([openGraphLocale('ru'), openGraphLocale('uz'), openGraphLocale('en')]).toEqual(['ru_RU', 'uz_UZ', 'en_US']);
  });
});

describe('language addresses', () => {
  it('keeps Russian at the plain address and puts other languages in ?lang=', () => {
    expect(localizedPath('/', 'ru')).toBe('/');
    expect(localizedPath('/club/a', 'uz')).toBe('/club/a?lang=uz');
    expect(languageAlternates('/club/a')).toEqual({ ru: '/club/a', uz: '/club/a?lang=uz', en: '/club/a?lang=en', 'x-default': '/club/a' });
  });
});
