import { describe, expect, it, vi } from 'vitest';
import { reviewReplyPrompt } from '@/lib/googleBusiness/reviews';
import { buildYandexReplies, parseYandexReplies, parseYandexReviews, toGoogleShape, yandexReviewDateIso, type YandexReviewSnapshot } from './reviews';

const SNAPSHOT = {
  rating: '4,9',
  reviewCount: '128 отзывов',
  reviews: [
    { key: 'r2', author: 'Азиз', date: '12 ноября 2026', rating: 5, text: 'Отличный клуб' },
    { author: 'Dilnoza', date: '3 марта 2026', rating: '4', text: 'Yaxshi' },
    { key: 'r3', author: 'Олег', date: '1 мая 2026', rating: 2, text: 'Шумно', answered: true },
    { key: 'r2', author: 'Дубль', text: 'повтор' },
    { foo: 'bar' },
    null,
  ],
};

describe('parseYandexReviews', () => {
  it('reads the card rating, review count and usable reviews', () => {
    const snapshot = parseYandexReviews(SNAPSHOT);
    expect(snapshot.rating).toBe(4.9);
    expect(snapshot.reviewCount).toBe(128);
    expect(snapshot.reviews.map((review) => [review.key, review.rating, review.answered])).toEqual([
      ['r2', 5, false],
      ['Dilnoza|3 марта 2026|Yaxshi', 4, false],
      ['r3', 2, true],
    ]);
  });

  it('accepts a bare array and rejects anything else', () => {
    expect(parseYandexReviews([{ author: 'A', text: 'B' }]).reviews).toHaveLength(1);
    expect(parseYandexReviews('nope')).toEqual({ rating: null, reviewCount: null, reviews: [] });
  });
});

describe('yandexReviewDateIso', () => {
  it('reads Russian, dotted and ISO dates', () => {
    expect(yandexReviewDateIso('12 ноября 2026')).toBe('2026-11-12');
    expect(yandexReviewDateIso('1 мая 2026')).toBe('2026-05-01');
    expect(yandexReviewDateIso('3 марта 2026')).toBe('2026-03-03');
    expect(yandexReviewDateIso('5.1.2026')).toBe('2026-01-05');
    expect(yandexReviewDateIso('2026-11-12T10:00:00Z')).toBe('2026-11-12');
    expect(yandexReviewDateIso('вчера')).toBeNull();
    expect(yandexReviewDateIso(null)).toBeNull();
  });
});

describe('toGoogleShape', () => {
  it('feeds the existing Google reply prompt', () => {
    const review = parseYandexReviews(SNAPSHOT).reviews[0];
    expect(toGoogleShape(review)).toEqual({ name: 'r2', reviewerName: 'Азиз', starRating: 5, comment: 'Отличный клуб', createTime: '2026-11-12', hasReply: false });
    expect(reviewReplyPrompt(toGoogleShape(review), 'Pixel Gaming')).toContain('Review text: Отличный клуб');
  });
});

describe('buildYandexReplies', () => {
  const snapshot: YandexReviewSnapshot = parseYandexReviews(SNAPSHOT);

  it('writes replies for unanswered reviews, oldest first', async () => {
    const write = vi.fn(async (review: { reviewerName: string | null }) => `Спасибо, ${review.reviewerName}!`);
    const file = await buildYandexReplies(snapshot, null, 'Pixel Gaming', write);
    expect(file.rating).toBe(4.9);
    expect(file.replies.map((entry) => [entry.author, entry.reply, entry.posted])).toEqual([
      ['Dilnoza', 'Спасибо, Dilnoza!', false],
      ['Азиз', 'Спасибо, Азиз!', false],
    ]);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ name: 'r2' }), 'Pixel Gaming');
  });

  it('keeps replies from the reviews file and the earlier run', async () => {
    const write = vi.fn(async () => 'new');
    const withReply = { ...snapshot, reviews: snapshot.reviews.map((review) => (review.key === 'r2' ? { ...review, reply: 'Своими словами' } : review)) };
    const previous = parseYandexReplies({ replies: [{ key: 'Dilnoza|3 марта 2026|Yaxshi', reply: 'Rahmat!', posted: true }] });
    const file = await buildYandexReplies(withReply, previous, 'Pixel Gaming', write);
    expect(file.replies.map((entry) => [entry.reply, entry.posted])).toEqual([['Rahmat!', true], ['Своими словами', false]]);
    expect(write).not.toHaveBeenCalled();
  });

  it('records why a reply is missing', async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error('model down')).mockResolvedValueOnce(null);
    const file = await buildYandexReplies(snapshot, null, 'Pixel Gaming', failing);
    expect(file.replies.map((entry) => entry.error)).toEqual(['model down', 'The model returned no reply']);
    const noModel = await buildYandexReplies(snapshot, null, 'Pixel Gaming', null);
    expect(noModel.replies.every((entry) => entry.reply === null && entry.error === 'No AI model is configured')).toBe(true);
  });
});

describe('parseYandexReplies', () => {
  it('drops rows without a key and reads the posted mark', () => {
    expect(parseYandexReplies({ rating: 5, reviewCount: 3, replies: [{ key: 'a', reply: 'x', posted: true, error: '' }, { reply: 'y' }] })).toEqual({
      rating: 5,
      reviewCount: 3,
      replies: [{ key: 'a', author: null, date: null, rating: null, text: null, reply: 'x', posted: true }],
    });
    expect(parseYandexReplies(null)).toEqual({ rating: null, reviewCount: null, replies: [] });
  });
});
