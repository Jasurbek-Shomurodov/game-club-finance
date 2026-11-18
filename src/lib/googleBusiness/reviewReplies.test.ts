import { describe, expect, it, vi } from 'vitest';
import { GoogleApiError } from './api';
import { MAX_REPLIES_PER_CLUB, replyToAllReviews, replyToClubReviews, type ReviewReplyClub, type ReviewReplyDeps } from './reviewReplies';

const CLUB: ReviewReplyClub = { clubId: 'club-1', clubName: 'Pixel Gaming', locationPath: 'https://mybusiness.googleapis.com/v4/accounts/1/locations/2' };
const rawReview = (id: string, extra: Record<string, unknown> = {}) => ({
  name: `accounts/1/locations/2/reviews/${id}`,
  starRating: 'FIVE',
  comment: `review ${id}`,
  createTime: `2026-11-${id.padStart(2, '0')}T00:00:00Z`,
  ...extra,
});

function deps(overrides: Partial<ReviewReplyDeps> = {}): ReviewReplyDeps {
  return {
    accessToken: vi.fn(async () => 'token'),
    listReviews: vi.fn(async () => ({ reviews: [rawReview('2'), rawReview('1'), rawReview('3', { reviewReply: { comment: 'ok' } })] })),
    repliedReviewNames: vi.fn(async () => new Set<string>()),
    writeReply: vi.fn(async (review) => `Thanks for ${review.comment}`),
    postReply: vi.fn(async () => ({})),
    recordReply: vi.fn(async () => undefined),
    hasTime: () => true,
    log: vi.fn(),
    ...overrides,
  };
}

describe('replyToClubReviews', () => {
  it('replies to unanswered reviews, oldest first, and records each', async () => {
    const d = deps();
    const outcome = await replyToClubReviews(CLUB, d);
    expect(outcome).toMatchObject({ clubId: 'club-1', replied: 2, remaining: 0, failed: 0 });
    expect(outcome.results.map((r) => [r.comment, r.status, r.reply])).toEqual([
      ['review 1', 'published', 'Thanks for review 1'],
      ['review 2', 'published', 'Thanks for review 2'],
    ]);
    expect(vi.mocked(d.postReply).mock.calls.map((call) => call[1])).toEqual([
      'accounts/1/locations/2/reviews/1',
      'accounts/1/locations/2/reviews/2',
    ]);
    expect(d.recordReply).toHaveBeenCalledTimes(2);
  });

  it('follows pages and skips reviews already recorded', async () => {
    const listReviews = vi.fn()
      .mockResolvedValueOnce({ reviews: [rawReview('1')], nextPageToken: 'p2' })
      .mockResolvedValueOnce({ reviews: [rawReview('2')] });
    const d = deps({ listReviews, repliedReviewNames: async () => new Set(['accounts/1/locations/2/reviews/1']) });
    const outcome = await replyToClubReviews(CLUB, d);
    expect(listReviews).toHaveBeenLastCalledWith('token', CLUB.locationPath, 'p2');
    expect(outcome.replied).toBe(1);
  });

  it('keeps the rating and review count from the first page', async () => {
    const listReviews = vi.fn().mockResolvedValueOnce({ reviews: [], averageRating: 4.7, totalReviewCount: 120 });
    const outcome = await replyToClubReviews(CLUB, deps({ listReviews }));
    expect(outcome).toMatchObject({ averageRating: 4.7, totalReviewCount: 120, results: [] });
  });

  it('caps the replies per run and reports what is left', async () => {
    const reviews = Array.from({ length: MAX_REPLIES_PER_CLUB + 3 }, (_, index) => rawReview(String(index + 1)));
    const outcome = await replyToClubReviews(CLUB, deps({ listReviews: async () => ({ reviews }) }));
    expect(outcome).toMatchObject({ replied: MAX_REPLIES_PER_CLUB, remaining: 3 });
  });

  it('skips a review whose reply could not be written or posted', async () => {
    const writeReply = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('Thanks');
    const postReply = vi.fn().mockRejectedValueOnce(new GoogleApiError('INVALID', 'bad'));
    const outcome = await replyToClubReviews(CLUB, deps({ writeReply, postReply }));
    expect(outcome).toMatchObject({ replied: 0, failed: 2, remaining: 2 });
    expect(outcome.results.map((r) => r.status)).toEqual(['failed', 'failed']);
    expect(outcome.error).toBeUndefined();
  });

  it('stops the club on an access error', async () => {
    const postReply = vi.fn().mockRejectedValue(new GoogleApiError('QUOTA', 'not approved', 429));
    const outcome = await replyToClubReviews(CLUB, deps({ postReply }));
    expect(postReply).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ replied: 0, error: 'QUOTA', remaining: 2 });
  });

  it('counts a posted reply even when recording it fails', async () => {
    const outcome = await replyToClubReviews(CLUB, deps({ recordReply: async () => { throw new Error('db'); } }));
    expect(outcome.replied).toBe(2);
  });
});

describe('replyToAllReviews', () => {
  it('continues with the next club after one fails and stops when time runs out', async () => {
    let calls = 0;
    const d = deps({
      accessToken: async (club) => {
        if (club.clubId === 'bad') throw new GoogleApiError('RECONNECT', 'revoked');
        return 'token';
      },
      hasTime: () => calls++ < 4,
    });
    const outcomes = await replyToAllReviews([{ ...CLUB, clubId: 'bad' }, CLUB, { ...CLUB, clubId: 'late' }], d);
    expect(outcomes.map((o) => [o.clubId, o.error ?? null])).toEqual([['bad', 'RECONNECT'], ['club-1', null]]);
  });
});
