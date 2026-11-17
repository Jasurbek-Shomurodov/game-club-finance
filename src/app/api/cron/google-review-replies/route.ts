import { replyToReview, listReviews } from '@/lib/googleBusiness/api';
import { createReviewReplyWriter } from '@/lib/googleBusiness/replyWriter';
import { replyToAllReviews, type ReviewReplyClub } from '@/lib/googleBusiness/reviewReplies';
import { connectedAccessToken, googleConfig, locationPath, type GoogleConnectionRow } from '@/lib/googleBusiness/server';
import { cronAuthorizationStatus } from '@/lib/cronAuth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Stop starting new replies once less than this much of maxDuration remains.
const RESERVE_MS = 15_000;

function log(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ scope: 'google-review-replies', event, ...fields }));
}

/**
 * Daily (Supabase Cron, migration 152): replies to new Google Maps reviews of
 * every connected listing whose owner left auto replies on.
 */
export async function GET(request: Request) {
  const startedAt = Date.now();
  const authorization = cronAuthorizationStatus(request);
  if (authorization === 'invalid_configuration') return Response.json({ ok: false, error: 'CRON_SECRET is not configured' }, { status: 500 });
  if (authorization === 'unauthorized') return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const config = googleConfig();
  if (!config) return Response.json({ ok: false, error: 'Google is not configured' }, { status: 503 });
  const writeReply = createReviewReplyWriter();
  if (!writeReply) return Response.json({ ok: false, error: 'No AI model is configured' }, { status: 503 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('google_business_connections')
    .select('club_id, google_email, refresh_token_encrypted, account_name, location_name, location_title, connected_at, clubs(name)')
    .eq('review_auto_reply', true)
    .not('location_name', 'is', null);
  if (error) {
    log('load_failed', { code: error.code, error: error.message });
    return Response.json({ ok: false, error: 'Could not load connections' }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as (GoogleConnectionRow & { clubs: { name: string } | null })[];
  const connections = new Map(rows.map((row) => [row.club_id, row]));
  const clubs: ReviewReplyClub[] = rows.flatMap((row) => {
    const path = locationPath(row);
    return path ? [{ clubId: row.club_id, clubName: row.location_title ?? row.clubs?.name ?? 'the club', locationPath: path }] : [];
  });

  const outcomes = await replyToAllReviews(clubs, {
    accessToken: async (club) => (await connectedAccessToken(config, connections.get(club.clubId)!)).accessToken,
    listReviews: (accessToken, path, pageToken) => listReviews(accessToken, path, pageToken),
    async repliedReviewNames(clubId) {
      const { data: replied, error: readError } = await supabase
        .from('google_review_replies')
        .select('review_name')
        .eq('club_id', clubId);
      if (readError) throw readError;
      return new Set((replied ?? []).map((row) => row.review_name as string));
    },
    writeReply,
    postReply: (accessToken, reviewName, reply) => replyToReview(accessToken, reviewName, reply),
    async recordReply(clubId, review, reply) {
      const { error: insertError } = await supabase.from('google_review_replies').upsert({
        club_id: clubId,
        review_name: review.name,
        reviewer_name: review.reviewerName,
        star_rating: review.starRating,
        review_comment: review.comment,
        review_time: review.createTime,
        reply_comment: reply,
      }, { onConflict: 'review_name' });
      if (insertError) throw insertError;
    },
    hasTime: () => Date.now() - startedAt < maxDuration * 1000 - RESERVE_MS,
    log,
  });

  log('finished', { outcomes });
  return Response.json({ ok: outcomes.every((outcome) => !outcome.error), outcomes }, { headers: { 'cache-control': 'no-store' } });
}
