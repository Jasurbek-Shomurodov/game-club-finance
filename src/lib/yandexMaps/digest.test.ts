import { describe, expect, it } from 'vitest';
import { buildReviewDigestBlocks, YANDEX_MAPS_DIGEST_SOURCE } from '@/lib/googleBusiness/reviewDigestImage';
import { generatedAtOf, priceCaptionLine, priceDiffCounts, uploadedPriceCounts, yandexDigestCaption, yandexReportDecision, yandexReviewDigest } from './digest';
import type { YandexReplyFile } from './reviews';

const CLUB = { clubName: 'Pixel Gaming', address: 'Матбуотчилар 17' };
const REPLIES: YandexReplyFile = {
  rating: 4.9,
  reviewCount: 128,
  replies: [
    { key: 'a', author: 'Азиз', date: '12 ноября 2026', rating: 5, text: 'Отлично', reply: 'Спасибо!', posted: true },
    { key: 'b', author: null, date: null, rating: 3, text: 'Норм', reply: 'Спасибо за отзыв', posted: false },
    { key: 'c', author: 'Олег', date: null, rating: 1, text: 'Плохо', reply: null, posted: false, error: 'model down' },
  ],
};

describe('yandexReviewDigest', () => {
  it('counts only posted replies as sent', () => {
    const digest = yandexReviewDigest(CLUB, REPLIES, '2026-11-26');
    expect(digest).toMatchObject({ digestDate: '2026-11-26', averageRating: 4.9, totalReviewCount: 128, replied: 1, failed: 2, remaining: 0, error: null });
    expect(digest.results.map((result) => result.status)).toEqual(['published', 'failed', 'failed']);
    const tiles = buildReviewDigestBlocks(digest, null, YANDEX_MAPS_DIGEST_SOURCE).find((block) => block.type === 'tiles');
    expect(tiles).toMatchObject({ tiles: [{ value: '4,9', sub: 'на Яндекс Картах' }, { value: '128' }, { value: '1' }, { value: '2' }] });
  });

  it('puts the newest review first, undated ones last', () => {
    const replies: YandexReplyFile = { rating: null, reviewCount: null, replies: [
      { key: '1', author: 'A', date: '3 ноября 2026', rating: 5, text: null, reply: 'x', posted: true },
      { key: '2', author: 'B', date: null, rating: 5, text: null, reply: 'x', posted: true },
      { key: '3', author: 'C', date: '2026-11-20', rating: 5, text: null, reply: 'x', posted: true },
      { key: '4', author: 'D', date: '12.11.2026', rating: 5, text: null, reply: 'x', posted: true },
    ] };
    expect(yandexReviewDigest(CLUB, replies, '2026-11-26').results.map((result) => result.reviewerName)).toEqual(['C', 'D', 'A', 'B']);
  });

  it('draws up to 12 reviews, then a count of the rest', () => {
    const many: YandexReplyFile = { rating: null, reviewCount: null, replies: Array.from({ length: 14 }, (_, i) => ({
      key: String(i), author: `R${i}`, date: null, rating: 5, text: 'ok', reply: 'спасибо', posted: true,
    })) };
    const blocks = buildReviewDigestBlocks(yandexReviewDigest(CLUB, many, '2026-11-26'), null, YANDEX_MAPS_DIGEST_SOURCE);
    expect(blocks.filter((block) => block.type === 'review')).toHaveLength(12);
    expect(blocks).toContainEqual({ type: 'note', text: '…и ещё 2' });
  });

  it('handles a day without reviews', () => {
    expect(yandexReviewDigest({ clubName: 'X', address: null }, { rating: null, reviewCount: null, replies: [] }, '2026-11-26'))
      .toMatchObject({ replied: 0, failed: 0, results: [] });
  });
});

describe('yandexDigestCaption', () => {
  const digest = yandexReviewDigest(CLUB, REPLIES, '2026-11-26');

  it('names the club, date, replies and price-list changes', () => {
    expect(yandexDigestCaption(digest, { total: 14, added: 2, removed: 1, changed: 3, renamed: 4 }))
      .toBe('🤖 ИИ-бот Pixel Gaming (Матбуотчилар 17): отзывы Яндекс Карт за 26.11.2026. Ответов отправлено: 1. Прайс-лист: 14 позиций, новых 2, убрано 1, цена изменена 3, переименовано 4.');
  });

  it('writes only the non-zero parts of the price line', () => {
    expect(priceCaptionLine({ total: 21, added: 0, removed: 0, changed: 0, renamed: 13 })).toBe('Прайс-лист: 21 позиция, переименовано 13.');
    expect(priceCaptionLine({ total: 3, added: 1, removed: 0, changed: 0, renamed: 0 })).toBe('Прайс-лист: 3 позиции, новых 1.');
    expect(priceCaptionLine({ total: 11, added: 0, removed: 0, changed: 0, renamed: 0 })).toBe('Прайс-лист: 11 позиций.');
    expect(priceCaptionLine({ total: null, added: 0, removed: 2, changed: 0, renamed: 0 })).toBe('Прайс-лист: убрано 2.');
    expect(priceCaptionLine({ total: null, added: 0, removed: 0, changed: 0, renamed: 0 })).toBe('Прайс-лист: без изменений.');
  });

  it('leaves out what it does not know', () => {
    expect(yandexDigestCaption({ ...digest, address: null }, null))
      .toBe('🤖 ИИ-бот Pixel Gaming: отзывы Яндекс Карт за 26.11.2026. Ответов отправлено: 1.');
  });

  it('counts a diff, price changes only', () => {
    const after = { id: 'z1', name: 'a', price: 2, category: { id: '1', name: 'VIP' }, description: 'new', picture: null, zoneId: null, card: { label: 'VIP', headline: '1 час', timeWindow: null } };
    expect(priceDiffCounts({
      added: [],
      removed: [{ name: 'a', price: 1 }],
      changed: [
        { name: 'a', before: { name: 'a', price: 1 }, after, fields: ['price'] },
        { name: 'b', before: { name: 'b', price: 2, description: 'old' }, after, fields: ['description'] },
      ],
      renamed: [{ before: { name: 'c', price: 2 }, after }],
    }, 9)).toEqual({ total: 9, added: 0, removed: 1, changed: 1, renamed: 1 });
  });
});

describe('uploadedPriceCounts', () => {
  const counts = { total: 14, added: 2, removed: 1, changed: 0, renamed: 3 };

  it('gives the counts only once the plan is marked uploaded', () => {
    expect(uploadedPriceCounts({ uploaded: true, diffCounts: counts })).toEqual(counts);
    // A plan saved before renames and the total were counted.
    expect(uploadedPriceCounts({ uploaded: true, diffCounts: { added: 2, removed: 1, changed: 0 } })).toEqual({ total: null, added: 2, removed: 1, changed: 0, renamed: 0 });
    expect(uploadedPriceCounts({ uploaded: true, diffCounts: { ...counts, total: -1 } })).toBeNull();
    expect(uploadedPriceCounts({ uploaded: true, diffCounts: { ...counts, renamed: 'x' } })).toBeNull();
    expect(uploadedPriceCounts({ diffCounts: counts })).toBeNull();
    expect(uploadedPriceCounts({ uploaded: 'yes', diffCounts: counts })).toBeNull();
    expect(uploadedPriceCounts({ uploaded: true, diffCounts: null })).toBeNull();
    expect(uploadedPriceCounts({ uploaded: true, diffCounts: { added: -1, removed: 0, changed: 0 } })).toBeNull();
    expect(uploadedPriceCounts(null)).toBeNull();
  });
});

describe('yandexReportDecision', () => {
  // Club day starting at 08:00 Tashkent (UTC+5): 03:00 UTC.
  const businessDateOf = (instant: Date) => new Date(instant.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const base = { alreadySent: false, resend: false, digestDate: '2026-11-26', businessDateOf };

  it('sends files made on the business date once', () => {
    expect(yandexReportDecision({ ...base, generatedAt: ['2026-11-26T10:00:00Z', '2026-11-26T04:00:00Z'] })).toBe('send');
    expect(yandexReportDecision({ ...base, alreadySent: true, generatedAt: ['2026-11-26T10:00:00Z'] })).toBe('already_sent');
    expect(yandexReportDecision({ ...base, alreadySent: true, resend: true, generatedAt: ['2026-11-26T10:00:00Z'] })).toBe('send');
  });

  it('refuses files from another business date or without a time', () => {
    expect(yandexReportDecision({ ...base, generatedAt: ['2026-11-26T10:00:00Z', '2026-11-26T01:00:00Z'] })).toBe('stale');
    expect(yandexReportDecision({ ...base, generatedAt: ['2026-11-25T10:00:00Z'] })).toBe('stale');
    expect(yandexReportDecision({ ...base, resend: true, alreadySent: true, generatedAt: [null] })).toBe('stale');
  });

  it('reads generatedAt', () => {
    expect(generatedAtOf({ generatedAt: '2026-11-26T10:00:00.000Z' })).toBe('2026-11-26T10:00:00.000Z');
    expect(generatedAtOf({ generatedAt: 'yesterday' })).toBeNull();
    expect(generatedAtOf(null)).toBeNull();
  });
});
