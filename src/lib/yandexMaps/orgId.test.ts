import { describe, expect, it } from 'vitest';
import { yandexOrgId } from './orgId';

describe('yandexOrgId', () => {
  it('reads the organisation id from a place link', () => {
    expect(yandexOrgId('https://yandex.uz/maps/org/pixel_gaming/226249440799/')).toBe('226249440799');
    expect(yandexOrgId('yandex.ru/maps/org/pixel_gaming/76261965061')).toBe('76261965061');
    expect(yandexOrgId('https://yandex.uz/maps/org/pixel_gaming/76261965061/reviews/?ll=69.2,41.3')).toBe('76261965061');
  });

  it('returns null for links without a place', () => {
    expect(yandexOrgId(null)).toBeNull();
    expect(yandexOrgId('')).toBeNull();
    expect(yandexOrgId('https://yandex.uz/maps/?text=Pixel')).toBeNull();
    expect(yandexOrgId('https://example.com/maps/org/x/123/')).toBeNull();
  });
});
