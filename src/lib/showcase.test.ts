import { describe, expect, it } from 'vitest';
import {
  SHOWCASE_SLUG_PATTERN,
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
    const payload = buildShowcaseSettingsPayload({ ...showcaseSettingsForm(null, 'Neon'), telegram_url: '@neon', tagline: ' ' });
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
