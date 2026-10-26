import { describe, expect, it } from 'vitest';
import {
  SHOWCASE_SLUG_PATTERN,
  normalizeEmail,
  normalizeYoutubeUrl,
  totalConsoleCount,
  mapLinks,
  buildShowcaseOfferPayload,
  showcaseOfferForm,
  validateShowcaseOffer,
  localizedFromRow,
  missingLanguages,
  pickLocalized,
  brandInsights,
  buildShowcaseBrandPayload,
  clubInsights,
  parsePublicBrand,
  showcaseBrandForm,
  validateShowcaseBrand,
  buildShowcasePcZonePayload,
  buildShowcaseSettingsPayload,
  lowestHourlyPrice,
  nextSortOrder,
  normalizeExternalUrl,
  normalizeInstagramUrl,
  normalizeTelegramUrl,
  parsePublicShowcase,
  showcaseImagePath,
  showcasePcZoneForm,
  showcaseSettingsForm,
  slugifyClubName,
  telHref,
  totalPcCount,
  validateShowcaseGame,
  validateShowcasePcZone,
  validateShowcaseSettings,
} from './showcase';

describe('slugifyClubName', () => {
  it('builds a valid slug from Latin and Cyrillic names', () => {
    expect(slugifyClubName('Game Zone №1')).toBe('game-zone-1');
    expect(slugifyClubName('Киберклуб Ташкент')).toBe('kiberklub-tashkent');
    expect(SHOWCASE_SLUG_PATTERN.test(slugifyClubName('Game Zone №1'))).toBe(true);
  });
});

describe('links', () => {
  it('keeps only http(s) URLs', () => {
    expect(normalizeExternalUrl('example.com/a')).toBe('https://example.com/a');
    expect(normalizeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeExternalUrl('  ')).toBeNull();
  });

  it('expands social handles', () => {
    expect(normalizeTelegramUrl('@club')).toBe('https://t.me/club');
    expect(normalizeInstagramUrl('@club')).toBe('https://instagram.com/club');
  });

  it('builds tel links only for real numbers', () => {
    expect(telHref('+998 90 123-45-67')).toBe('tel:+998901234567');
    expect(telHref('ab')).toBeNull();
  });
});

describe('settings form', () => {
  it('proposes a slug from the club name and validates it', () => {
    const form = showcaseSettingsForm(null, 'Neon Arena');
    expect(form.slug).toBe('neon-arena');
    expect(validateShowcaseSettings(form)).toBeNull();
    expect(validateShowcaseSettings({ ...form, slug: '-bad' })).toBe('slug_invalid');
    expect(validateShowcaseSettings({ ...form, instagram_url: 'javascript:x' })).toBe('instagram_invalid');
  });

  it('writes blanks as null and normalizes links', () => {
    const payload = buildShowcaseSettingsPayload({ ...showcaseSettingsForm(null, 'Neon'), telegram_url: '@neon', tagline: { ru: ' ', uz: '', en: '' } });
    expect(payload.telegram_url).toBe('https://t.me/neon');
    expect(payload.tagline).toBeNull();
  });
});

describe('items', () => {
  it('validates games and zones', () => {
    expect(validateShowcaseGame({ title: '', genre: '', image_url: '', sort_order: '10' })).toBe('title_required');
    expect(validateShowcaseGame({ title: 'CS2', genre: '', image_url: '', sort_order: 'x' })).toBe('sort_order_invalid');
    const zone = showcasePcZoneForm(null, 10);
    expect(validateShowcasePcZone(zone)).toBe('name_required');
    expect(validateShowcasePcZone({ ...zone, name: 'VIP', pc_count: '0' })).toBe('pc_count_invalid');
  });

  it('parses the formatted hourly price and keeps a blank price null', () => {
    const zone = { ...showcasePcZoneForm(null, 10), name: 'VIP', price_per_hour: '15 000' };
    expect(buildShowcasePcZonePayload(zone).price_per_hour).toBe(15000);
    expect(buildShowcasePcZonePayload({ ...zone, price_per_hour: '' }).price_per_hour).toBeNull();
  });

  it('places new items after the existing ones', () => {
    expect(nextSortOrder([])).toBe(10);
    expect(nextSortOrder([{ sort_order: 30 }, { sort_order: 5 }])).toBe(40);
  });

  it('names uploads inside the club folder', () => {
    expect(showcaseImagePath('club-1', 'game', 'Cover.PNG', 'abc')).toBe('club-1/game-abc.png');
    expect(showcaseImagePath('club-1', 'hero', 'blob', 'abc')).toBe('club-1/hero-abc.jpg');
  });
});

describe('parsePublicShowcase', () => {
  it('drops unsafe links and malformed rows', () => {
    const parsed = parsePublicShowcase({
      club_name: 'Neon',
      slug: 'neon',
      telegram_url: 'javascript:alert(1)',
      games: [{ id: 'g1', title: 'CS2', image_url: 'https://cdn/x.jpg' }, { id: 'g2', title: '' }, null],
      zones: [{ id: 'z1', name: 'VIP', pc_count: '5', price_per_hour: '20000' }, { id: 'z2', name: 'Pro', pc_count: 3, price_per_hour: null }],
    });
    expect(parsed?.telegram_url).toBeNull();
    expect(parsed?.games).toEqual([{ id: 'g1', title: 'CS2', genre: null, image_url: 'https://cdn/x.jpg' }]);
    expect(totalPcCount(parsed!.zones)).toBe(8);
    expect(lowestHourlyPrice(parsed!.zones)).toBe(20000);
  });

  it('returns null for an unpublished or unknown page', () => {
    expect(parsePublicShowcase(null)).toBeNull();
    expect(parsePublicShowcase({ slug: 'x' })).toBeNull();
  });
});

describe('brand', () => {
  const brandPayload = {
    slug: 'pixel-gaming',
    name: 'Pixel Gaming',
    instagram_url: 'javascript:x',
    clubs: [
      {
        club_name: 'Pixel Chilonzor', slug: 'chilonzor',
        games: [{ id: 'g1', title: 'CS2' }, { id: 'g2', title: 'Dota 2' }],
        zones: [
          { id: 'z1', name: 'Standard', pc_count: 20, gpu: 'RTX 4060', monitor: '24" 165 Hz', price_per_hour: 12000 },
          { id: 'z2', name: 'VIP', pc_count: 8, gpu: 'RTX 4080', monitor: '27" 240 Гц', price_per_hour: 25000 },
        ],
      },
      { club_name: 'Pixel Yunusobod', slug: 'yunusobod', games: [{ id: 'g3', title: 'cs2 ' }], zones: [{ id: 'z3', name: 'Pro', pc_count: 6, price_per_hour: 15000 }] },
      { slug: 'broken' },
    ],
  };

  it('parses clubs and drops unsafe links and broken clubs', () => {
    const brand = parsePublicBrand(brandPayload);
    expect(brand?.instagram_url).toBeNull();
    expect(brand?.clubs.map((club) => club.slug)).toEqual(['chilonzor', 'yunusobod']);
    expect(parsePublicBrand({ slug: 'x' })).toBeNull();
  });

  it('summarizes one club', () => {
    const club = parsePublicBrand(brandPayload)!.clubs[0];
    expect(clubInsights(club)).toEqual({
      pcCount: 28, consoleCount: 0, zoneCount: 2, gameCount: 2, minPrice: 12000, maxPrice: 25000, topGpu: 'RTX 4080', maxRefreshHz: 240,
    });
  });

  it('summarizes the whole brand with distinct game titles', () => {
    expect(brandInsights(parsePublicBrand(brandPayload)!)).toEqual({ clubCount: 2, pcCount: 34, consoleCount: 0, gameCount: 2, minPrice: 12000 });
  });

  it('validates the brand form', () => {
    const form = { ...showcaseBrandForm(null), slug: 'pixel-gaming' };
    expect(validateShowcaseBrand(form)).toBe('brand_name_required');
    expect(validateShowcaseBrand({ ...form, name: 'Pixel Gaming' })).toBeNull();
    expect(buildShowcaseBrandPayload({ ...form, name: ' Pixel ', telegram_url: '@pixel' })).toMatchObject({ name: 'Pixel', telegram_url: 'https://t.me/pixel' });
  });
});

describe('structured PC specs', () => {
  const zone = { ...showcasePcZoneForm(null, 10), name: 'VIP' };

  it('validates monitor size in inches and refresh rate', () => {
    expect(validateShowcasePcZone({ ...zone, monitor_size_inches: '27,5', monitor_refresh_hz: '240' })).toBeNull();
    expect(validateShowcasePcZone({ ...zone, monitor_size_inches: '5' })).toBe('monitor_size_invalid');
    expect(validateShowcasePcZone({ ...zone, monitor_size_inches: 'big' })).toBe('monitor_size_invalid');
    expect(validateShowcasePcZone({ ...zone, monitor_refresh_hz: '144.5' })).toBe('monitor_refresh_invalid');
  });

  it('saves numbers and blank equipment as null', () => {
    const payload = buildShowcasePcZonePayload({ ...zone, monitor_size_inches: '27,5', monitor_refresh_hz: '240', mouse: ' Logitech G Pro ', keyboard: '' });
    expect(payload).toMatchObject({ monitor_size_inches: 27.5, monitor_refresh_hz: 240, mouse: 'Logitech G Pro', keyboard: null });
    expect(buildShowcasePcZonePayload(zone)).toMatchObject({ monitor_size_inches: null, monitor_refresh_hz: null });
  });

  it('prefers the structured refresh rate for insights', () => {
    const club = parsePublicShowcase({
      club_name: 'X', slug: 'x', games: [],
      zones: [{ id: 'z', name: 'VIP', pc_count: 5, monitor: '24" 144 Hz', monitor_refresh_hz: 360, monitor_size_inches: '27', mouse: 'G Pro' }],
    })!;
    expect(club.zones[0]).toMatchObject({ monitor_size_inches: 27, monitor_refresh_hz: 360, mouse: 'G Pro', keyboard: null });
    expect(clubInsights(club).maxRefreshHz).toBe(360);
  });
});

describe('languages', () => {
  it('stores each filled language and keeps the first as the fallback column', () => {
    const form = { ...showcaseSettingsForm(null, 'Neon'), tagline: { ru: '', uz: ' Zo‘r klub ', en: 'Great club' } };
    expect(buildShowcaseSettingsPayload(form)).toMatchObject({
      tagline: 'Zo‘r klub',
      translations: { tagline: { uz: 'Zo‘r klub', en: 'Great club' }, headline: {} },
    });
    expect(missingLanguages(form.tagline)).toEqual(['ru']);
  });

  it('opens a page saved before translations with its text under Russian', () => {
    expect(localizedFromRow(undefined, 'tagline', 'Старый текст')).toEqual({ ru: 'Старый текст', uz: '', en: '' });
    expect(localizedFromRow({ tagline: { en: 'Hi' } }, 'tagline', 'Старый')).toEqual({ ru: '', uz: '', en: 'Hi' });
  });

  it('shows visitors their language, then the next filled one, then the old column', () => {
    const raw = { club_name: 'X', slug: 'x', tagline: 'legacy', translations: { tagline: { ru: 'Привет', en: 'Hello' } }, games: [], zones: [] };
    expect(parsePublicShowcase(raw, 'en')?.tagline).toBe('Hello');
    expect(parsePublicShowcase(raw, 'uz')?.tagline).toBe('Привет');
    expect(parsePublicShowcase({ ...raw, translations: {} }, 'uz')?.tagline).toBe('legacy');
    expect(pickLocalized({ ru: 5 }, 'ru', null)).toBeNull();
    const brand = parsePublicBrand({ slug: 'b', name: 'B', translations: { tagline: { uz: 'Salom' } }, clubs: [raw] }, 'uz');
    expect(brand?.tagline).toBe('Salom');
    expect(brand?.clubs[0].tagline).toBe('Привет');
  });
});

describe('offers', () => {
  it('needs a name in at least one language and saves the price and badge', () => {
    const form = showcaseOfferForm(null, 10);
    expect(validateShowcaseOffer(form)).toBe('offer_title_required');
    const filled = { ...form, title: { ru: '', uz: 'Tungi paket', en: 'Night package' }, badge: ' 2+1 ', price: '50 000', time_window: '22:00 – 08:00' };
    expect(validateShowcaseOffer(filled)).toBeNull();
    expect(buildShowcaseOfferPayload(filled)).toMatchObject({
      title: 'Tungi paket', badge: '2+1', price: 50000, time_window: '22:00 – 08:00', is_active: true,
      translations: { title: { uz: 'Tungi paket', en: 'Night package' }, description: {} },
    });
  });

  it('shows visitors each offer in their language and drops nameless ones', () => {
    const club = parsePublicShowcase({
      club_name: 'X', slug: 'x', games: [], zones: [],
      offers: [
        { id: 'o1', title: 'Ночной', translations: { title: { en: 'Night' }, description: { ru: 'Всю ночь' } }, badge: 'NIGHT', price: '60000', time_window: '22:00 – 08:00' },
        { id: 'o2', title: '' },
      ],
    }, 'en')!;
    expect(club.offers).toEqual([{ id: 'o1', title: 'Night', description: 'Всю ночь', badge: 'NIGHT', price: 60000, time_window: '22:00 – 08:00' }]);
  });
});

describe('map links', () => {
  it('searches the club name and address in both maps', () => {
    expect(mapLinks({ club_name: 'Pixel Gaming', address: 'Matbuotchilar 17' })).toEqual({
      yandex: 'https://yandex.uz/maps/?text=Pixel%20Gaming%2C%20Matbuotchilar%2017',
      google: 'https://www.google.com/maps/search/?api=1&query=Pixel%20Gaming%2C%20Matbuotchilar%2017',
    });
    expect(mapLinks({ club_name: 'X', address: '  ' })).toBeNull();
  });
});

describe('PlayStation zones', () => {
  it('saves console fields only for PlayStation and PC fields only for PCs', () => {
    const base = { ...showcasePcZoneForm(null, 10, 'playstation'), name: 'PS5 lounge', pc_count: '3', console: 'PlayStation 5', controllers: '2', cpu: 'stale', mouse: 'stale', headset: 'Pulse 3D' };
    expect(base.kind).toBe('playstation');
    expect(buildShowcasePcZonePayload(base)).toMatchObject({ kind: 'playstation', console: 'PlayStation 5', controllers: 2, cpu: null, mouse: null, headset: 'Pulse 3D' });
    expect(buildShowcasePcZonePayload({ ...base, kind: 'pc', cpu: 'i5' })).toMatchObject({ kind: 'pc', console: null, controllers: null, cpu: 'i5' });
    expect(validateShowcasePcZone({ ...base, controllers: '25' })).toBe('controllers_invalid');
  });

  it('counts consoles apart from computers and keeps TVs out of the monitor insight', () => {
    const club = parsePublicShowcase({
      club_name: 'X', slug: 'x', games: [],
      zones: [
        { id: 'z1', kind: 'pc', name: 'VIP', pc_count: 10, monitor_refresh_hz: 240 },
        { id: 'z2', kind: 'playstation', name: 'PS5', pc_count: 3, console: 'PS5 Pro', controllers: 2, monitor_refresh_hz: 120, gpu: 'ignored' },
        { id: 'z3', kind: 'nonsense', name: 'Old', pc_count: 4 },
      ],
    })!;
    expect(club.zones.map((zone) => zone.kind)).toEqual(['pc', 'playstation', 'pc']);
    expect(totalConsoleCount(club.zones)).toBe(3);
    expect(clubInsights(club)).toMatchObject({ pcCount: 14, consoleCount: 3, maxRefreshHz: 240, topGpu: null });
  });
});

describe('contact links', () => {
  it('normalizes email and YouTube and rejects bad values', () => {
    expect(normalizeEmail(' Info@Pixel.uz ')).toBe('info@pixel.uz');
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizeYoutubeUrl('@pixelgaming')).toBe('https://youtube.com/@pixelgaming');
    const form = { ...showcaseSettingsForm(null, 'Neon'), email: 'bad', youtube_url: '' };
    expect(validateShowcaseSettings(form)).toBe('email_invalid');
    expect(validateShowcaseSettings({ ...form, email: '', youtube_url: 'javascript:x' })).toBe('youtube_invalid');
    expect(buildShowcaseBrandPayload({ ...showcaseBrandForm(null), name: 'P', slug: 'pp-x', email: 'A@B.CO', phone: ' +998 ' })).toMatchObject({ email: 'a@b.co', phone: '+998' });
  });
});

describe('club order on the brand page', () => {
  it('saves a whole-number position and refuses anything else', () => {
    const form = { ...showcaseSettingsForm(null, 'Pixel'), sort_order: '1' };
    expect(validateShowcaseSettings(form)).toBeNull();
    expect(buildShowcaseSettingsPayload(form).sort_order).toBe(1);
    expect(validateShowcaseSettings({ ...form, sort_order: 'first' })).toBe('sort_order_invalid');
    expect(showcaseSettingsForm(null, 'Pixel').sort_order).toBe('0');
  });
});
