// Google Maps reviews: what the Business Profile API returns, which reviews
// still need the club's reply, and the prompt and clean-up for an AI-written
// reply. Pure, so it is tested without Google or a model.

const STAR_RATINGS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** Google accepts replies up to 4 096 bytes; stay well inside it. */
export const MAX_REPLY_LENGTH = 1000;

export interface GoogleReview {
  /** `accounts/<id>/locations/<id>/reviews/<id>`. */
  name: string;
  reviewerName: string | null;
  starRating: number | null;
  comment: string | null;
  createTime: string | null;
  hasReply: boolean;
}

export interface ReviewReplyRecord {
  reviewName: string;
  reviewerName: string | null;
  starRating: number | null;
  reviewComment: string | null;
  replyComment: string;
  repliedAt: string;
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * Google appends a machine translation to reviews written in another language
 * ("… (Translated by Google) …" or "(Original) …"). Keep the reviewer's own words.
 */
export function originalReviewText(comment: string | null): string | null {
  if (!comment) return null;
  const original = comment.match(/\(Original\)\s*([\s\S]+)$/);
  if (original) return original[1].trim() || null;
  const translated = comment.split(/\(Translated by Google\)/)[0];
  return translated.trim() || null;
}

/** One review from `accounts.locations.reviews.list`, or null when it is unusable. */
export function parseReview(raw: unknown): GoogleReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const review = raw as Record<string, unknown>;
  const name = text(review.name);
  if (!name || !/^accounts\/\d+\/locations\/\d+\/reviews\/[^/]+$/.test(name)) return null;
  const reviewer = review.reviewer as { displayName?: unknown; isAnonymous?: unknown } | undefined;
  const reply = review.reviewReply as { comment?: unknown } | undefined;
  return {
    name,
    reviewerName: reviewer?.isAnonymous === true ? null : text(reviewer?.displayName),
    starRating: STAR_RATINGS[String(review.starRating)] ?? null,
    comment: originalReviewText(text(review.comment)),
    createTime: text(review.createTime),
    hasReply: Boolean(text(reply?.comment)),
  };
}

/** Reviews without a reply, oldest first so a backlog is answered in order. */
export function reviewsNeedingReply(reviews: readonly GoogleReview[], alreadyReplied: ReadonlySet<string>) {
  return reviews
    .filter((review) => !review.hasReply && !alreadyReplied.has(review.name))
    .sort((a, b) => (a.createTime ?? '').localeCompare(b.createTime ?? ''));
}

export const REVIEW_REPLY_SYSTEM_PROMPT = `You write the owner's public reply to a Google Maps review of a gaming club in Tashkent, Uzbekistan (computers and PlayStation).

Rules:
- Reply in the language the review is written in: Uzbek (Latin script), Russian or English. If the review has no text, reply with one short sentence in Uzbek, then the same sentence in Russian.
- Be warm, natural and brief: one to three sentences, under 400 characters. Vary the wording; do not sound like a template.
- Thank the reviewer. Use their first name only if it looks like a real name.
- For complaints or a low rating: apologise sincerely, do not argue or deny, say the team will look into it, and invite them to speak to the administrator on their next visit.
- Never promise refunds, discounts, free time, prizes or anything specific. Never invent facts about the club, prices or opening hours.
- No hashtags, links, phone numbers or signatures. At most one emoji.
- Output only the reply text, without quotation marks.`;

/** The per-review message for the model. */
export function reviewReplyPrompt(review: GoogleReview, clubName: string) {
  return [
    `Club: ${clubName}`,
    `Rating: ${review.starRating ? `${review.starRating} of 5 stars` : 'not given'}`,
    `Reviewer: ${review.reviewerName ?? 'anonymous'}`,
    `Review text: ${review.comment ?? '(no text, rating only)'}`,
  ].join('\n');
}

/** Trims what the model wrote; null when nothing usable is left. */
export function cleanReply(raw: string): string | null {
  let reply = raw.trim();
  // Models sometimes wrap the reply in quotes or a "Reply:" label.
  reply = reply.replace(/^(reply|answer|ответ|javob)\s*:\s*/i, '');
  reply = reply.replace(/^["«“']([\s\S]*)["»”']$/, '$1').trim();
  if (!reply) return null;
  if (reply.length > MAX_REPLY_LENGTH) {
    const cut = reply.slice(0, MAX_REPLY_LENGTH);
    const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    reply = (sentenceEnd > 0 ? cut.slice(0, sentenceEnd + 1) : cut).trim();
  }
  return reply;
}
