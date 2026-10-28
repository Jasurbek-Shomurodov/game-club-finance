import { describe, expect, it } from 'vitest';
import {
  buildLocalPost,
  emptyGooglePostForm,
  parseGooglePostForm,
  summarizeLocalPost,
  validateGooglePost,
  type GooglePostForm,
} from './posts';

const form = (patch: Partial<GooglePostForm> = {}): GooglePostForm => ({ ...emptyGooglePostForm('ru'), summary: 'Турнир по CS2 в субботу', ...patch });

describe('validateGooglePost', () => {
  it('accepts a plain update and requires its text', () => {
    expect(validateGooglePost(form())).toBeNull();
    expect(validateGooglePost(form({ summary: '   ' }))).toBe('summary_required');
    expect(validateGooglePost(form({ summary: 'x'.repeat(1501) }))).toBe('summary_too_long');
  });

  it('requires https links for photos and buttons, except Call', () => {
    expect(validateGooglePost(form({ photoUrl: 'http://example.test/a.jpg' }))).toBe('photo_invalid');
    expect(validateGooglePost(form({ ctaType: 'BOOK', ctaUrl: '' }))).toBe('cta_url_invalid');
    expect(validateGooglePost(form({ ctaType: 'BOOK', ctaUrl: 'https://t.me/pixel' }))).toBeNull();
    expect(validateGooglePost(form({ ctaType: 'CALL' }))).toBeNull();
  });

  it('needs a title and ordered dates for events and offers', () => {
    const event = form({ kind: 'event', summary: '', title: 'CS2 Cup', startDate: '2026-11-01', endDate: '2026-11-02' });
    expect(validateGooglePost(event)).toBeNull();
    expect(validateGooglePost({ ...event, title: '' })).toBe('title_required');
    expect(validateGooglePost({ ...event, title: 'x'.repeat(59) })).toBe('title_too_long');
    expect(validateGooglePost({ ...event, endDate: '' })).toBe('dates_required');
    expect(validateGooglePost({ ...event, endDate: '2026-10-31' })).toBe('dates_order');
    expect(validateGooglePost({ ...event, kind: 'offer', couponCode: 'x'.repeat(59) })).toBe('coupon_too_long');
  });
});

describe('parseGooglePostForm', () => {
  it('rejects unknown kinds, languages and buttons', () => {
    expect(parseGooglePostForm(null)).toBeNull();
    expect(parseGooglePostForm({ ...form(), kind: 'story' })).toBeNull();
    expect(parseGooglePostForm({ ...form(), language: 'de' })).toBeNull();
    expect(parseGooglePostForm({ ...form(), ctaType: 'CALL_ME' })).toBeNull();
  });

  it('keeps strings only', () => {
    expect(parseGooglePostForm({ ...form(), summary: 42, ctaType: undefined })).toEqual({ ...form(), summary: '', ctaType: 'NONE' });
  });
});

describe('buildLocalPost', () => {
  it('builds a standard post with a photo and a button', () => {
    expect(buildLocalPost(form({ photoUrl: ' https://cdn.test/a.jpg ', ctaType: 'BOOK', ctaUrl: 'https://t.me/pixel' }))).toEqual({
      languageCode: 'ru',
      topicType: 'STANDARD',
      summary: 'Турнир по CS2 в субботу',
      media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://cdn.test/a.jpg' }],
      callToAction: { actionType: 'BOOK', url: 'https://t.me/pixel' },
    });
    expect(buildLocalPost(form({ ctaType: 'CALL' })).callToAction).toEqual({ actionType: 'CALL' });
  });

  it('builds an event schedule from ISO dates', () => {
    expect(buildLocalPost(form({ kind: 'event', summary: '', title: ' CS2 Cup ', startDate: '2026-11-01', endDate: '2026-11-02' }))).toEqual({
      languageCode: 'ru',
      topicType: 'EVENT',
      event: { title: 'CS2 Cup', schedule: { startDate: { year: 2026, month: 11, day: 1 }, endDate: { year: 2026, month: 11, day: 2 } } },
    });
  });

  it('puts an offer link, code and terms on the offer, not a button', () => {
    const post = buildLocalPost(form({
      kind: 'offer', title: 'Night package', startDate: '2026-11-01', endDate: '2026-11-30',
      ctaType: 'LEARN_MORE', ctaUrl: 'https://pixelgaming.uz', couponCode: 'NIGHT', terms: '22:00–08:00',
    }));
    expect(post.callToAction).toBeUndefined();
    expect(post.topicType).toBe('OFFER');
    expect(post.offer).toEqual({ couponCode: 'NIGHT', redeemOnlineUrl: 'https://pixelgaming.uz', termsConditions: '22:00–08:00' });
  });
});

describe('summarizeLocalPost', () => {
  it('reduces a Google post to the listed fields', () => {
    expect(summarizeLocalPost({
      name: 'accounts/1/locations/2/localPosts/3',
      topicType: 'EVENT',
      summary: 'Hi',
      state: 'PROCESSING',
      createTime: '2026-10-29T10:00:00Z',
      searchUrl: 'https://local.google.com/place?id=1',
      event: { title: 'Cup' },
      media: [{ googleUrl: 'https://lh3.googleusercontent.com/x' }],
    })).toEqual({
      name: 'accounts/1/locations/2/localPosts/3',
      kind: 'event',
      summary: 'Hi',
      title: 'Cup',
      state: 'PROCESSING',
      createTime: '2026-10-29T10:00:00Z',
      searchUrl: 'https://local.google.com/place?id=1',
      photoUrl: 'https://lh3.googleusercontent.com/x',
    });
    expect(summarizeLocalPost({ summary: 'no name' })).toBeNull();
    expect(summarizeLocalPost({ name: 'n' })).toMatchObject({ kind: 'update', state: 'LIVE', title: null, photoUrl: null });
  });
});
