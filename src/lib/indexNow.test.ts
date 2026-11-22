import { describe, expect, it } from 'vitest';
import { INDEXNOW_KEY, indexNowPayload } from './indexNow';

describe('indexNowPayload', () => {
  it('lists every language of the home page and each club', () => {
    expect(indexNowPayload('https://www.pixelgaming.uz', ['a'])).toEqual({
      host: 'www.pixelgaming.uz',
      key: INDEXNOW_KEY,
      keyLocation: 'https://www.pixelgaming.uz/indexnow-key.txt',
      urlList: [
        'https://www.pixelgaming.uz/',
        'https://www.pixelgaming.uz/?lang=uz',
        'https://www.pixelgaming.uz/?lang=en',
        'https://www.pixelgaming.uz/club/a',
        'https://www.pixelgaming.uz/club/a?lang=uz',
        'https://www.pixelgaming.uz/club/a?lang=en',
      ],
    });
  });
});
