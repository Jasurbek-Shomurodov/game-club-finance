// After the daily review-reply run, sends each club's "AI bot" image to its
// Telegram group at most once a day. The send is claimed in
// `google_review_digests` first: a timeout leaves the outcome unknown, so a
// claimed day is never sent again. Every outside call is passed in.

import type { ClubReplyOutcome } from './reviewReplies';
import type { ReviewDigest, ReviewDigestPrevious } from './reviewDigestImage';

export interface ReviewDigestDeps {
  /** The club's Telegram group, or null when it has none. */
  chatId(clubId: string): string | null;
  /** Inserts the day's row with the send claimed; false when it already exists. */
  claim(clubId: string, digest: ReviewDigest, chatId: string): Promise<boolean>;
  /** The latest earlier digest's numbers, for the day-over-day deltas. */
  previous(clubId: string, digestDate: string): Promise<ReviewDigestPrevious | null>;
  render(digest: ReviewDigest, previous: ReviewDigestPrevious | null): Promise<Buffer>;
  send(chatId: string, png: Buffer, caption: string, fileName: string): Promise<number | null>;
  complete(clubId: string, digestDate: string, result: { messageId: number | null } | { error: string }): Promise<void>;
  log(event: string, fields: Record<string, unknown>): void;
}

export type ReviewDigestStatus = 'sent' | 'held' | 'skipped' | 'failed';

export interface ReviewDigestClub {
  clubId: string;
  clubName: string;
  address: string | null;
}

export function reviewDigestFromOutcome(club: ReviewDigestClub, outcome: ClubReplyOutcome, digestDate: string): ReviewDigest {
  return {
    digestDate,
    clubName: club.clubName,
    address: club.address,
    averageRating: outcome.averageRating,
    totalReviewCount: outcome.totalReviewCount,
    replied: outcome.replied,
    failed: outcome.failed,
    remaining: Math.max(outcome.remaining - outcome.failed, 0),
    error: outcome.error ?? null,
    results: outcome.results,
  };
}

export function reviewDigestCaption(digest: ReviewDigest) {
  const where = digest.address ? ` (${digest.address})` : '';
  return `🤖 ИИ-бот ${digest.clubName}${where}: отзывы Google Maps за ${digest.digestDate.split('-').reverse().join('.')}. Ответов отправлено: ${digest.replied}.`;
}

export async function sendReviewDigest(club: ReviewDigestClub, digest: ReviewDigest, deps: ReviewDigestDeps): Promise<ReviewDigestStatus> {
  const chatId = deps.chatId(club.clubId);
  if (!chatId) return 'skipped';
  try {
    if (!(await deps.claim(club.clubId, digest, chatId))) return 'held';
  } catch (error) {
    deps.log('digest_claim_failed', { clubId: club.clubId, error: error instanceof Error ? error.message : String(error) });
    return 'failed';
  }

  try {
    const previous = await deps.previous(club.clubId, digest.digestDate).catch(() => null);
    const png = await deps.render(digest, previous);
    const messageId = await deps.send(chatId, png, reviewDigestCaption(digest), `google-reviews-${digest.digestDate}.png`);
    await deps.complete(club.clubId, digest.digestDate, { messageId }).catch((error: unknown) => {
      deps.log('digest_record_failed', { clubId: club.clubId, error: error instanceof Error ? error.message : String(error) });
    });
    return 'sent';
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    deps.log('digest_send_failed', { clubId: club.clubId, error: message });
    await deps.complete(club.clubId, digest.digestDate, { error: message }).catch(() => undefined);
    return 'failed';
  }
}
