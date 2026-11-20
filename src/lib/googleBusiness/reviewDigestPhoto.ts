// The "AI bot" image the daily finance report adds to its album when the
// morning review-reply run left one waiting for it (migration 173).

import type { SupabaseClient } from '@supabase/supabase-js';
import { reviewDigestCaption } from './reviewDigest';
import { renderReviewDigestPng } from './reviewDigestImage';
import { fetchAwaitingReviewDigest, fetchPreviousReviewDigest } from './reviewDigestRows';

export interface ReviewDigestPhoto {
  digestDate: string;
  png: Buffer;
  fileName: string;
  /** Its own caption, used only when it is sent apart from the report. */
  caption: string;
  /** One line added to the report's caption when it rides in the album. */
  reportLine: string;
}

export async function loadAwaitingReviewDigestPhoto(
  supabase: SupabaseClient,
  clubId: string,
): Promise<ReviewDigestPhoto | null> {
  const digest = await fetchAwaitingReviewDigest(supabase, clubId);
  if (!digest) return null;
  const previous = await fetchPreviousReviewDigest(supabase, clubId, digest.digestDate).catch(() => null);
  return {
    digestDate: digest.digestDate,
    png: await renderReviewDigestPng(digest, previous),
    fileName: `google-reviews-${digest.digestDate}.png`,
    caption: reviewDigestCaption(digest),
    reportLine: `🤖 ИИ-бот: ответов на отзывы Google Maps: ${digest.replied}`,
  };
}
