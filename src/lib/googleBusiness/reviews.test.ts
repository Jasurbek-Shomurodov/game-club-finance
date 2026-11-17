import { describe, expect, it } from 'vitest';
import { cleanReply, MAX_REPLY_LENGTH, originalReviewText, parseReview, reviewReplyPrompt, reviewsNeedingReply, type GoogleReview } from './reviews';

const NAME = 'accounts/111/locations/222/reviews/abc';

function review(overrides: Partial<GoogleReview> = {}): GoogleReview {
  return { name: NAME, reviewerName: 'Aziz', starRating: 5, comment: 'Zo‘r joy', createTime: '2026-11-01T10:00:00Z', hasReply: false, ...overrides };
}

describe('parseReview', () => {
  it('reads the fields Google returns', () => {
    expect(parseReview({
      name: NAME,
      reviewer: { displayName: 'Aziz' },
      starRating: 'FOUR',
      comment: ' Good PCs ',
      createTime: '2026-11-01T10:00:00Z',
    })).toEqual(review({ starRating: 4, comment: 'Good PCs' }));
  });

  it('marks a replied review and hides anonymous names', () => {
    expect(parseReview({ name: NAME, reviewer: { displayName: 'A Google user', isAnonymous: true }, starRating: 'FIVE', reviewReply: { comment: 'Thanks' } }))
      .toMatchObject({ reviewerName: null, hasReply: true, comment: null });
  });

  it('rejects anything without a review resource name', () => {
    expect(parseReview(null)).toBeNull();
    expect(parseReview({ name: 'locations/1' })).toBeNull();
  });
});

describe('originalReviewText', () => {
  it('keeps the reviewer words when Google adds a translation', () => {
    expect(originalReviewText('Отличный клуб\n\n(Translated by Google) Great club')).toBe('Отличный клуб');
    expect(originalReviewText('(Translated by Google) Great club\n\n(Original)\nОтличный клуб')).toBe('Отличный клуб');
    expect(originalReviewText('Plain')).toBe('Plain');
  });
});

describe('reviewsNeedingReply', () => {
  it('skips replied and recorded reviews and puts the oldest first', () => {
    const older = review({ name: 'accounts/1/locations/2/reviews/old', createTime: '2026-01-01T00:00:00Z' });
    const newer = review({ name: 'accounts/1/locations/2/reviews/new', createTime: '2026-02-01T00:00:00Z' });
    const answered = review({ name: 'accounts/1/locations/2/reviews/done', hasReply: true });
    const recorded = review({ name: 'accounts/1/locations/2/reviews/rec' });
    expect(reviewsNeedingReply([newer, answered, older, recorded], new Set([recorded.name])).map((r) => r.name))
      .toEqual([older.name, newer.name]);
  });
});

describe('reviewReplyPrompt', () => {
  it('describes a rating-only review', () => {
    expect(reviewReplyPrompt(review({ comment: null, starRating: null, reviewerName: null }), 'Pixel Gaming'))
      .toBe('Club: Pixel Gaming\nRating: not given\nReviewer: anonymous\nReview text: (no text, rating only)');
  });
});

describe('cleanReply', () => {
  it('strips quotes and labels', () => {
    expect(cleanReply('  "Rahmat, Aziz!"  ')).toBe('Rahmat, Aziz!');
    expect(cleanReply('Ответ: «Спасибо!»')).toBe('Спасибо!');
    expect(cleanReply('   ')).toBeNull();
  });

  it('cuts an over-long reply at a sentence end', () => {
    const long = `${'Rahmat. '.repeat(200)}`;
    const reply = cleanReply(long)!;
    expect(reply.length).toBeLessThanOrEqual(MAX_REPLY_LENGTH);
    expect(reply.endsWith('.')).toBe(true);
  });
});
