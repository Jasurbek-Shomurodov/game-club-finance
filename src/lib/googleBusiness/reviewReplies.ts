// The daily review-reply run: for each connected listing with auto replies on,
// read its reviews, write a reply to each one that has none and post it.
// Every outside call is passed in, so the run is tested without Google, a
// model or the database.

import { GoogleApiError, type GoogleApiErrorCode } from './api';
import { parseReview, reviewsNeedingReply, type GoogleReview } from './reviews';

/** Pages of 50 reviews read per listing: enough to reach an old backlog. */
export const REVIEW_PAGES = 3;
/** Replies posted per listing per run, so one busy listing cannot use the whole run. */
export const MAX_REPLIES_PER_CLUB = 10;

export interface ReviewReplyClub {
  clubId: string;
  clubName: string;
  /** v4 location path from `v4LocationPath`. */
  locationPath: string;
}

export interface ReviewListPage {
  reviews?: unknown[];
  nextPageToken?: string;
  averageRating?: number;
  totalReviewCount?: number;
}

/** One review the run handled, for the daily Telegram image. */
export interface ReviewReplyResult {
  starRating: number | null;
  reviewerName: string | null;
  comment: string | null;
  reply: string | null;
  status: 'published' | 'failed';
}

export interface ReviewReplyDeps {
  accessToken(club: ReviewReplyClub): Promise<string>;
  listReviews(accessToken: string, locationPath: string, pageToken?: string): Promise<ReviewListPage>;
  repliedReviewNames(clubId: string): Promise<Set<string>>;
  writeReply(review: GoogleReview, clubName: string): Promise<string | null>;
  postReply(accessToken: string, reviewName: string, reply: string): Promise<unknown>;
  recordReply(clubId: string, review: GoogleReview, reply: string): Promise<void>;
  /** False once the run must stop starting new replies. */
  hasTime(): boolean;
  log(event: string, fields: Record<string, unknown>): void;
}

export interface ClubReplyOutcome {
  clubId: string;
  replied: number;
  /** Reviews still without a reply after this run. */
  remaining: number;
  /** Reviews whose reply could not be written or posted this run. */
  failed: number;
  error?: GoogleApiErrorCode | 'FAILED';
  /** The listing's rating and review count as Google reports them, when read. */
  averageRating: number | null;
  totalReviewCount: number | null;
  results: ReviewReplyResult[];
}

/** Errors that end the club's run: every later call would fail the same way. */
const STOPPING: readonly GoogleApiErrorCode[] = ['RECONNECT', 'QUOTA', 'FORBIDDEN'];

async function readReviews(deps: ReviewReplyDeps, accessToken: string, locationPath: string) {
  const reviews: GoogleReview[] = [];
  let averageRating: number | null = null;
  let totalReviewCount: number | null = null;
  let pageToken: string | undefined;
  for (let page = 0; page < REVIEW_PAGES; page += 1) {
    const body = await deps.listReviews(accessToken, locationPath, pageToken);
    if (page === 0) {
      averageRating = Number.isFinite(body.averageRating) ? Number(body.averageRating) : null;
      totalReviewCount = Number.isFinite(body.totalReviewCount) ? Number(body.totalReviewCount) : null;
    }
    for (const raw of body.reviews ?? []) {
      const review = parseReview(raw);
      if (review) reviews.push(review);
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return { reviews, averageRating, totalReviewCount };
}

export async function replyToClubReviews(club: ReviewReplyClub, deps: ReviewReplyDeps): Promise<ClubReplyOutcome> {
  const outcome: ClubReplyOutcome = {
    clubId: club.clubId, replied: 0, remaining: 0, failed: 0, averageRating: null, totalReviewCount: null, results: [],
  };
  const result = (review: GoogleReview, status: ReviewReplyResult['status'], reply: string | null) => {
    outcome.results.push({ starRating: review.starRating, reviewerName: review.reviewerName, comment: review.comment, reply, status });
  };
  let pending: GoogleReview[] = [];
  try {
    const accessToken = await deps.accessToken(club);
    const [listing, replied] = await Promise.all([
      readReviews(deps, accessToken, club.locationPath),
      deps.repliedReviewNames(club.clubId),
    ]);
    outcome.averageRating = listing.averageRating;
    outcome.totalReviewCount = listing.totalReviewCount;
    pending = reviewsNeedingReply(listing.reviews, replied);

    for (const review of pending.slice(0, MAX_REPLIES_PER_CLUB)) {
      if (!deps.hasTime()) break;
      const reply = await deps.writeReply(review, club.clubName).catch((error: unknown) => {
        deps.log('reply_write_failed', { clubId: club.clubId, review: review.name, error: error instanceof Error ? error.message : String(error) });
        return null;
      });
      if (!reply) {
        outcome.failed += 1;
        result(review, 'failed', null);
        continue;
      }
      try {
        await deps.postReply(accessToken, review.name, reply);
      } catch (error) {
        if (error instanceof GoogleApiError && STOPPING.includes(error.code)) throw error;
        deps.log('reply_post_failed', { clubId: club.clubId, review: review.name, error: error instanceof Error ? error.message : String(error) });
        outcome.failed += 1;
        result(review, 'failed', null);
        continue;
      }
      outcome.replied += 1;
      result(review, 'published', reply);
      // The reply is on Google; a failed record only hides it from the admin list.
      await deps.recordReply(club.clubId, review, reply).catch((error: unknown) => {
        deps.log('reply_record_failed', { clubId: club.clubId, review: review.name, error: error instanceof Error ? error.message : String(error) });
      });
    }
  } catch (error) {
    outcome.error = error instanceof GoogleApiError ? error.code : 'FAILED';
    deps.log('club_failed', { clubId: club.clubId, code: outcome.error, error: error instanceof Error ? error.message : String(error) });
  }
  outcome.remaining = Math.max(pending.length - outcome.replied, 0);
  return outcome;
}

export async function replyToAllReviews(clubs: readonly ReviewReplyClub[], deps: ReviewReplyDeps) {
  const outcomes: ClubReplyOutcome[] = [];
  for (const club of clubs) {
    if (!deps.hasTime()) break;
    outcomes.push(await replyToClubReviews(club, deps));
  }
  return outcomes;
}
