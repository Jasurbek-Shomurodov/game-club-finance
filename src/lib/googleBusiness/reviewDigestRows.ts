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

/** The club's newest digest still waiting for the daily report album, or null. */
export async function fetchAwaitingReviewDigest(
  supabase: SupabaseClient,
  clubId: string,
): Promise<ReviewDigest | null> {
  const { data, error } = await supabase
    .from('google_review_digests')
    .select('digest_date, average_rating, total_review_count, replied, failed, remaining, error, results, clubs(name, address)')
    .eq('club_id', clubId)
    .eq('awaiting_report', true)
    .order('digest_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const club = (data as unknown as { clubs: { name: string; address: string | null } | null }).clubs;
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
