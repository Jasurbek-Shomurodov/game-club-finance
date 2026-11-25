// Reads and writes of `google_review_digests` shared by the review-reply run
// (which saves the day's digest) and the daily finance report (which sends a
// digest still awaiting it inside its album, migration 173).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReviewDigest, ReviewDigestPrevious } from './reviewDigestImage';
import type { ReviewReplyResult } from './reviewReplies';

/** The latest earlier digest's numbers, for the day-over-day deltas. */
export async function fetchPreviousReviewDigest(
  supabase: SupabaseClient,
  clubId: string,
  digestDate: string,
): Promise<ReviewDigestPrevious | null> {
  const { data, error } = await supabase
    .from('google_review_digests')
    .select('average_rating, total_review_count')
    .eq('club_id', clubId)
    .lt('digest_date', digestDate)
    .order('digest_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    averageRating: data.average_rating === null ? null : Number(data.average_rating),
    totalReviewCount: data.total_review_count,
  };
}

const DIGEST_COLUMNS = 'digest_date, average_rating, total_review_count, replied, failed, remaining, error, results, clubs(name, address)';

type DigestRow = {
  digest_date: string;
  average_rating: string | number | null;
  total_review_count: number | null;
  replied: number;
  failed: number;
  remaining: number;
  error: string | null;
  results: unknown;
  clubs: { name: string; address: string | null } | null;
};

function toReviewDigest(data: DigestRow): ReviewDigest {
  const club = data.clubs;
  return {
    digestDate: data.digest_date,
    clubName: club?.name ?? 'Pixel Gaming',
    address: club?.address?.trim() || null,
    averageRating: data.average_rating === null ? null : Number(data.average_rating),
    totalReviewCount: data.total_review_count,
    replied: data.replied,
    failed: data.failed,
    remaining: data.remaining,
    error: data.error,
    results: (data.results ?? []) as ReviewReplyResult[],
  };
}

/** The club's newest digest still waiting for the daily report album, or null. */
export async function fetchAwaitingReviewDigest(
  supabase: SupabaseClient,
  clubId: string,
): Promise<ReviewDigest | null> {
  const { data, error } = await supabase
    .from('google_review_digests')
    .select(DIGEST_COLUMNS)
    .eq('club_id', clubId)
    .eq('awaiting_report', true)
    .order('digest_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toReviewDigest(data as unknown as DigestRow) : null;
}

/**
 * The club's digest of one day, whether or not it still waits for the report
 * (a forced resend of a report carries the digest its scheduled send did).
 */
export async function fetchReviewDigestOfDate(
  supabase: SupabaseClient,
  clubId: string,
  digestDate: string,
): Promise<{ digest: ReviewDigest; awaitingReport: boolean } | null> {
  const { data, error } = await supabase
    .from('google_review_digests')
    .select(`${DIGEST_COLUMNS}, awaiting_report`)
    .eq('club_id', clubId)
    .eq('digest_date', digestDate)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as DigestRow & { awaiting_report: boolean };
  return { digest: toReviewDigest(row), awaitingReport: row.awaiting_report === true };
}

/** Records how a digest's send ended and stops it waiting for the report. */
export async function completeReviewDigest(
  supabase: SupabaseClient,
  clubId: string,
  digestDate: string,
  result: { messageId: number | null } | { error: string },
): Promise<void> {
  const update = 'error' in result
    ? { send_error: result.error, awaiting_report: false }
    : { telegram_message_id: result.messageId, sent_at: new Date().toISOString(), send_error: null, awaiting_report: false };
  const { error } = await supabase
    .from('google_review_digests')
    .update(update)
    .eq('club_id', clubId)
    .eq('digest_date', digestDate);
  if (error) throw error;
}

/**
 * Records that a forced report resend carried an already-handled digest again:
 * it now points at the new album. It never makes the digest wait again, and a
 * failed resend is not recorded over the earlier send.
 */
export async function recordReviewDigestResend(
  supabase: SupabaseClient,
  clubId: string,
  digestDate: string,
  messageId: number | null,
): Promise<void> {
  const { error } = await supabase
    .from('google_review_digests')
    .update({ telegram_message_id: messageId, sent_at: new Date().toISOString(), send_error: null })
    .eq('club_id', clubId)
    .eq('digest_date', digestDate);
  if (error) throw error;
}
