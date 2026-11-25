// The "AI bot" image the daily finance report adds to its album when the
// morning review-reply run left one waiting for it (migration 173).

import type { SupabaseClient } from '@supabase/supabase-js';
import { dailyReportRunDateIso } from '@/lib/telegram/sendDailyFinanceReport';
import { reviewDigestCaption } from './reviewDigest';
import { renderReviewDigestPng, type ReviewDigest } from './reviewDigestImage';
import { fetchAwaitingReviewDigest, fetchPreviousReviewDigest, fetchReviewDigestOfDate } from './reviewDigestRows';

export interface ReviewDigestPhoto {
  digestDate: string;
  png: Buffer;
  fileName: string;
  /** Its own caption, used only when it is sent apart from the report. */
  caption: string;
  /** One line added to the report's caption when it rides in the album. */
  reportLine: string;
}

async function toReviewDigestPhoto(
  supabase: SupabaseClient,
  clubId: string,
  digest: ReviewDigest,
): Promise<ReviewDigestPhoto> {
  const previous = await fetchPreviousReviewDigest(supabase, clubId, digest.digestDate).catch(() => null);
  return {
    digestDate: digest.digestDate,
    png: await renderReviewDigestPng(digest, previous),
    fileName: `google-reviews-${digest.digestDate}.png`,
    caption: reviewDigestCaption(digest),
    reportLine: `🤖 ИИ-бот: ответов на отзывы Google Maps: ${digest.replied}`,
  };
}

export async function loadAwaitingReviewDigestPhoto(
  supabase: SupabaseClient,
  clubId: string,
): Promise<ReviewDigestPhoto | null> {
  const digest = await fetchAwaitingReviewDigest(supabase, clubId);
  return digest ? toReviewDigestPhoto(supabase, clubId, digest) : null;
}

/**
 * The digest the scheduled report of `businessDate` carries, for a forced
 * resend of that report. The morning review run stamps its digest with the
 * Tashkent date of that report's run (`dailyReportRunDateIso`: the business
 * date + 1, or + 2 for a day starting after the report hour).
 * `awaitingReport` says whether the scheduled send has not taken it yet.
 */
export async function loadReviewDigestPhotoForReport(
  supabase: SupabaseClient,
  clubId: string,
  businessDate: string,
  businessDayStartHour: number,
): Promise<(ReviewDigestPhoto & { awaitingReport: boolean }) | null> {
  const digestDate = dailyReportRunDateIso(businessDate, businessDayStartHour);
  const found = await fetchReviewDigestOfDate(supabase, clubId, digestDate);
  if (!found) return null;
  return { ...await toReviewDigestPhoto(supabase, clubId, found.digest), awaitingReport: found.awaitingReport };
}
