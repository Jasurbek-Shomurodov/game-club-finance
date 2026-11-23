import { describe, expect, it } from 'vitest';
import {
  HOURLY_COLUMN,
  SHOWCASE_GALLERY_LIMIT,
  bookingTimeSlots,
  buildPriceMatrix,
  buildShowcaseSettingsPayload,
  clubLabel,
  mapLinks,
  normalizeAmenities,
  normalizeGallery,
  normalizeGoogleMapsUrl,
  packageHours,
  parsePublicShowcase,
  showcaseSettingsForm,
  telegramDraftUrl,
  validateShowcaseSettings,
  yandexMapWidgetUrl,
} from './showcase';

const offer = (id: string, title: string, price: number | null, time_window: string | null = null, badge: string | null = null) =>
  ({ id, title, badge, price, description: null, time_window });

describe('buildPriceMatrix', () => {
  // Matbuotchilar: three tiers sold by package, a PlayStation zone with only an hourly rate, and combos.
  const offers = [
    offer('v1', 'VIP · 1 hour', 30000),
    offer('v21', 'VIP · 2+1 hours', 60000),
    offer('p1', 'Pro · 1 hour', 20000),
    offer('p21', 'Pro · 2+1 hours', 40000),
    offer('p7', 'Pro · 7 hours', 100000),
    offer('s1', 'Standard · 1 hour', 15000),
    offer('s21', 'Standard · 2+1 hours', 30000),
    offer('s7', 'Standard · 7 hours', 60000),
    offer('combo', 'Combo: 7 hours + ZarKebab set', 85000, null, 'COMBO'),
  ];
  const zones = [{ name: 'standard', price_per_hour: 15000 }, { name: 'PlayStation 5', price_per_hour: 40000 }];
  const matrix = buildPriceMatrix(offers, zones);

  it('puts the single hour first, then packages in display order', () => {
    expect(matrix.columns).toEqual([
      { key: HOURLY_COLUMN, label: null },
      { key: '2+1 hours', label: '2+1 hours' },
      { key: '7 hours', label: '7 hours' },
    ]);
  });

  it('gives each zone one row, and a zone with only a card rate its own', () => {
    expect(matrix.rows.map((row) => row.zone)).toEqual(['VIP', 'Pro', 'Standard', 'PlayStation 5']);
    expect(matrix.rows[3].cells).toEqual({ [HOURLY_COLUMN]: [{ price: 40000, time_window: null, saving: null }] });
    // A zone priced by its offers keeps the offer rate; the card rate is not added twice.
    expect(matrix.rows[2].cells[HOURLY_COLUMN]).toHaveLength(1);
  });

  it('shows what a package saves against single hours', () => {
    const pro = matrix.rows[1];
    expect(pro.cells['2+1 hours'][0].saving).toBe(20000);
    expect(pro.cells['7 hours'][0].saving).toBe(40000);
    // VIP sells no 7-hour package: the cell is simply absent.
    expect(matrix.rows[0].cells['7 hours']).toBeUndefined();
  });

  it('keeps offers without a zone as specials', () => {
    expect(matrix.specials.map((item) => item.id)).toEqual(['combo']);
  });

  it('keeps day and night prices of one zone in the same cell, each with its own saving', () => {
    const night = buildPriceMatrix([
      offer('d1', 'Standard · 1 hour', 10000, '06:00 – 18:00'),
      offer('n1', 'Standard · 1 hour', 15000, '18:00 – 06:00'),
      offer('d3', 'Standard · 3 hours', 25000, '06:00 – 18:00'),
      offer('n3', 'Standard · 3 hours', 40000, '18:00 – 06:00'),
      offer('np', 'Standard · Night package', 50000, '23:00 – 06:00'),
    ], [{ name: 'Standard', price_per_hour: 10000 }]);
    const [row] = night.rows;
    expect(row.cells[HOURLY_COLUMN].map((cell) => cell.price)).toEqual([10000, 15000]);
    expect(row.cells['3 hours'].map((cell) => cell.saving)).toEqual([5000, 5000]);
    // A package with no hour count has nothing to compare against.
    expect(row.cells['night package'][0].saving).toBeNull();
  });

  it('never shows a saving for a package that costs more than its hours', () => {
    const { rows } = buildPriceMatrix([offer('a', 'VIP · 1 hour', 10000), offer('b', 'VIP · 2 hours', 25000)], []);
    expect(rows[0].cells['2 hours'][0].saving).toBeNull();
  });

  it('is empty for a club with no prices', () => {
    expect(buildPriceMatrix([], [{ name: 'Standard', price_per_hour: null }])).toEqual({ columns: [], rows: [], specials: [] });
  });
});

describe('packageHours', () => {
  it('reads the hours a package name promises', () => {
    expect(packageHours('2+1 hours')).toBe(3);
    expect(packageHours('3 + 2 часа')).toBe(5);
    expect(packageHours('7 часов')).toBe(7);
    expect(packageHours('Ночной пакет')).toBeNull();
    expect(packageHours('23:00 night')).toBeNull();
  });
});

describe('club page extras', () => {
  it('keeps only known amenities, once each, in catalogue order', () => {
    expect(normalizeAmenities(['wifi', 'open_24_7', 'jacuzzi', 'wifi', 7])).toEqual(['open_24_7', 'wifi']);
    expect(normalizeAmenities(null)).toEqual([]);
  });

  it('keeps only safe, distinct photo links within the limit', () => {
    expect(normalizeGallery(['https://cdn.example/a.jpg', 'javascript:alert(1)', 'https://cdn.example/a.jpg', 5])).toEqual(['https://cdn.example/a.jpg']);
    const many = Array.from({ length: 20 }, (_, index) => `https://cdn.example/${index}.jpg`);
    expect(normalizeGallery(many)).toHaveLength(SHOWCASE_GALLERY_LIMIT);
  });

  it('accepts only Google Maps links for the saved place', () => {
    expect(normalizeGoogleMapsUrl('maps.app.goo.gl/AbC123')).toBe('https://maps.app.goo.gl/AbC123');
    expect(normalizeGoogleMapsUrl('https://www.google.com/maps/place/Pixel')).toBe('https://www.google.com/maps/place/Pixel');
    expect(normalizeGoogleMapsUrl('https://google.evil.example/maps')).toBeNull();
    expect(normalizeGoogleMapsUrl('https://yandex.uz/maps/org/a/1/')).toBeNull();
    const form = showcaseSettingsForm(null, 'Neon');
    expect(validateShowcaseSettings({ ...form, google_maps_url: 'https://example.com' })).toBe('google_maps_invalid');
  });

  it('saves branch, landmark and address per language beside the headline', () => {
    const form = {
      ...showcaseSettingsForm(null, 'Neon'),
      branch: { ru: ' Чиланзар ', uz: 'Chilonzor', en: '' },
      landmark: { ru: '', uz: '', en: 'Next to the metro' },
      amenities: ['wifi' as const, 'open_24_7' as const],
      gallery: ['https://cdn.example/a.jpg'],
    };
    const payload = buildShowcaseSettingsPayload(form);
    expect(payload.translations.branch).toEqual({ ru: 'Чиланзар', uz: 'Chilonzor' });
    expect(payload.translations.landmark).toEqual({ en: 'Next to the metro' });
    expect(payload.translations.address).toEqual({});
    expect(payload.amenities).toEqual(['open_24_7', 'wifi']);
    expect(payload.gallery).toEqual(['https://cdn.example/a.jpg']);
    expect(payload.google_maps_url).toBeNull();
  });

  it('reads a saved page back into the form', () => {
    const form = showcaseSettingsForm({
      club_id: 'c', slug: 'neon', is_published: true, headline: null, tagline: null, hero_image_url: null, address: 'Street 1', phone: null,
      opening_hours: null, telegram_url: null, instagram_url: null, updated_at: '2026-11-23T00:00:00Z',
      translations: { branch: { ru: 'Центр' } }, amenities: ['parking', 'unknown'], gallery: ['https://cdn.example/a.jpg'], google_maps_url: 'https://maps.app.goo.gl/x',
    }, 'Neon');
    expect(form.branch).toEqual({ ru: 'Центр', uz: '', en: '' });
    expect(form.amenities).toEqual(['parking']);
    expect(form.gallery).toEqual(['https://cdn.example/a.jpg']);
    expect(form.google_maps_url).toBe('https://maps.app.goo.gl/x');
  });
});

describe('parsePublicShowcase extras', () => {
  const payload = {
    club_name: 'Pixel Gaming (Algoritm)',
    slug: 'main-game-club',
    address: 'Chilonzor Algoritm',
    translations: {
      branch: { ru: 'Чиланзар', en: 'Chilanzar' },
      landmark: { ru: 'Район «Алгоритм»' },
      address: { ru: 'Ташкент, ул. Заргарлик, 30А', en: '30A Zargarlik St, Tashkent' },
    },
    amenities: ['card_payment', 'nope'],
    gallery: ['https://cdn.example/1.jpg', 'ftp://cdn.example/2.jpg'],
    google_maps_url: 'https://maps.app.goo.gl/x',
    google_rating: '4.80',
    google_review_count: 12,
  };

  it('picks the visitor\'s language and falls back to another one', () => {
    const english = parsePublicShowcase(payload, 'en');
    expect(english?.branch_name).toBe('Chilanzar');
    expect(english?.address).toBe('30A Zargarlik St, Tashkent');
    expect(english?.landmark).toBe('Район «Алгоритм»');
    expect(parsePublicShowcase(payload, 'uz')?.branch_name).toBe('Чиланзар');
  });

  it('reads amenities, photos, the map place and the rating defensively', () => {
    const club = parsePublicShowcase(payload, 'ru');
    expect(club?.amenities).toEqual(['card_payment']);
    expect(club?.gallery).toEqual(['https://cdn.example/1.jpg']);
    expect(club?.rating).toEqual({ value: 4.8, count: 12 });
    expect(mapLinks(club!)?.google).toBe('https://maps.app.goo.gl/x');
  });

  it('shows no rating without reviews or with a rating out of range', () => {
    expect(parsePublicShowcase({ ...payload, google_review_count: 0 })?.rating).toBeNull();
    expect(parsePublicShowcase({ ...payload, google_rating: 7 })?.rating).toBeNull();
    expect(parsePublicShowcase({ club_name: 'N', slug: 'n' })?.rating).toBeNull();
  });

  it('keeps the plain address and the club name when nothing is translated', () => {
    const plain = parsePublicShowcase({ club_name: 'Neon', slug: 'neon', address: 'Street 1' }, 'en')!;
    expect(plain.address).toBe('Street 1');
    expect(plain.branch_name).toBeNull();
    expect(clubLabel(plain)).toBe('Neon');
    expect(clubLabel({ club_name: 'Neon', branch_name: 'Centre' })).toBe('Centre');
  });
});

describe('yandexMapWidgetUrl', () => {
  it('embeds the club\'s own place and nothing else', () => {
    expect(yandexMapWidgetUrl('https://yandex.uz/maps/org/pixel_gaming/226249440799/')).toBe('https://yandex.uz/map-widget/v1/?oid=226249440799&ol=biz&z=16');
    expect(yandexMapWidgetUrl('https://yandex.uz/maps/-/CHu1abc')).toBeNull();
    expect(yandexMapWidgetUrl(null)).toBeNull();
  });
});

describe('booking request', () => {
  it('opens a personal Telegram chat with the message typed', () => {
    expect(telegramDraftUrl('https://t.me/PIXELGAMEZONE1', 'Привет! 2 часа')).toBe('https://t.me/PIXELGAMEZONE1?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82!%202%20%D1%87%D0%B0%D1%81%D0%B0');
  });

  it('leaves invite and other links as they are', () => {
    expect(telegramDraftUrl('https://t.me/+AbCdEf', 'hi')).toBe('https://t.me/+AbCdEf');
    expect(telegramDraftUrl('https://t.me/joinchat/xyz', 'hi')).toBe('https://t.me/joinchat/xyz');
  });

  it('offers the hours left today in Tashkent, and every hour tomorrow', () => {
    // 16:20 UTC is 21:20 in Tashkent.
    const evening = new Date('2026-11-23T16:20:00Z');
    expect(bookingTimeSlots(evening, 'today')).toEqual(['22:00', '23:00']);
    expect(bookingTimeSlots(evening, 'tomorrow')).toHaveLength(24);
    expect(bookingTimeSlots(evening, 'tomorrow')[0]).toBe('00:00');
    // 18:30 UTC is 23:30: no full hour is left today.
    expect(bookingTimeSlots(new Date('2026-11-23T18:30:00Z'), 'today')).toEqual([]);
  });
});
