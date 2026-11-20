import { replyToReview, listReviews } from '@/lib/googleBusiness/api';
import { createReviewReplyWriter } from '@/lib/googleBusiness/replyWriter';
import { reviewDigestFromOutcome, sendReviewDigest, type ReviewDigestDeps, type ReviewDigestStatus } from '@/lib/googleBusiness/reviewDigest';
import { renderReviewDigestPng } from '@/lib/googleBusiness/reviewDigestImage';
import { completeReviewDigest, fetchPreviousReviewDigest } from '@/lib/googleBusiness/reviewDigestRows';
import { replyToAllReviews, type ReviewReplyClub } from '@/lib/googleBusiness/reviewReplies';
import { connectedAccessToken, googleConfig, locationPath, type GoogleConnectionRow } from '@/lib/googleBusiness/server';
import { cronAuthorizationStatus } from '@/lib/cronAuth';
import { createServiceClient } from '@/lib/supabase/service';
import { targetChatId } from '@/lib/telegram/clubChat';
import { getClubBusinessDayStartHour, previousClubBusinessDateIso, sendTelegramPhoto } from '@/lib/telegram/sendDailyFinanceReport';
import { serverTodayIso } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Stop starting new replies once less than this much of maxDuration remains:
// enough to render and send each club's Telegram image afterwards.
const RESERVE_MS = 20_000;

function log(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ scope: 'google-review-replies', event, ...fields }));
}

/**
 * Daily at 07:50 Tashkent (Supabase Cron, migrations 152 and 173): replies to
 * new Google Maps reviews of every connected listing whose owner left auto
 * replies on, then gets each club's Telegram group the day's "AI bot" image
 * (migration 160): inside the 08:00 daily report album when that report is
 * still to go out, otherwise on its own.
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
    .select('club_id, google_email, refresh_token_encrypted, account_name, location_name, location_title, connected_at, clubs(name, address)')
    .eq('review_auto_reply', true)
    .not('location_name', 'is', null);
  if (error) {
    log('load_failed', { code: error.code, error: error.message });
    return Response.json({ ok: false, error: 'Could not load connections' }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as (GoogleConnectionRow & { clubs: { name: string; address: string | null } | null })[];
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

  const digestDate = serverTodayIso(new Date(), 0);
  const digestDeps = telegramDigestDeps(supabase);
  const summaries = [];
  for (const outcome of outcomes) {
    const row = connections.get(outcome.clubId)!;
    const club = { clubId: outcome.clubId, clubName: row.clubs?.name ?? 'Pixel Gaming', address: row.clubs?.address?.trim() || null };
    const digest: ReviewDigestStatus = digestDeps
      ? await sendReviewDigest(club, reviewDigestFromOutcome(club, outcome, digestDate), digestDeps)
      : 'skipped';
    summaries.push({
      clubId: outcome.clubId, replied: outcome.replied, remaining: outcome.remaining, failed: outcome.failed,
      ...(outcome.error ? { error: outcome.error } : {}), digest,
    });
  }

  log('finished', { outcomes: summaries });
  return Response.json({ ok: outcomes.every((outcome) => !outcome.error), outcomes: summaries }, { headers: { 'cache-control': 'no-store' } });
}

/** Telegram delivery of the daily image; null when no bot token is configured. */
function telegramDigestDeps(supabase: ReturnType<typeof createServiceClient>): ReviewDigestDeps | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) return null;
  return {
    chatId: (clubId) => targetChatId(clubId)?.trim() || null,
    async reportPending(clubId) {
      // The report sent next carries the club's last closed business day.
      const startHour = await getClubBusinessDayStartHour(supabase, clubId);
      const { data, error } = await supabase
        .from('telegram_report_deliveries')
        .select('id')
        .eq('club_id', clubId)
        .eq('business_date', previousClubBusinessDateIso(new Date(), startHour))
        .eq('delivery_key', 'scheduled')
        .in('status', ['sent', 'dispatching', 'manual_review'])
        .limit(1);
      if (error) throw error;
      return (data ?? []).length === 0;
    },
    async claim(clubId, digest, chatId, awaitingReport) {
      const { data, error } = await supabase.from('google_review_digests').upsert({
        club_id: clubId,
        digest_date: digest.digestDate,
        average_rating: digest.averageRating,
        total_review_count: digest.totalReviewCount,
        replied: digest.replied,
        failed: digest.failed,
        remaining: digest.remaining,
        error: digest.error,
        results: digest.results,
        telegram_chat_id: chatId,
        awaiting_report: awaitingReport,
      }, { onConflict: 'club_id,digest_date', ignoreDuplicates: true }).select('club_id');
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    previous: (clubId, date) => fetchPreviousReviewDigest(supabase, clubId, date),
    render: renderReviewDigestPng,
    async send(chatId, png, caption, fileName) {
      const result = await sendTelegramPhoto({ botToken, chatId, imagePng: png, imageFileName: fileName, caption, maxAttempts: 3, timeoutMs: 6_000 });
      return result.result.message_id ?? null;
    },
    complete: (clubId, date, result) => completeReviewDigest(supabase, clubId, date, result),
    log,
  };
}
