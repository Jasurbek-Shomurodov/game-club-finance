// Yandex Maps reviews. Yandex has no review API: the agent reads the club's
// Yandex Business "Отзывы" page into `reviews-<orgId>.json`
// (docs/runbooks/yandex-maps-sync.md), replies are written here with the
// same prompt and model chain as Google's, and the agent posts them in the
// page's reply box. Pure apart from the injected writer.

import type { GoogleReview } from '@/lib/googleBusiness/reviews';

export interface YandexReview {
  /** Stable id of the review within its card; built from author, date and text when the file has none. */
  key: string;
  author: string | null;
  /** As the page shows it ("12 ноября 2026") or ISO. */
  date: string | null;
  rating: number | null;
  text: string | null;
  /** True when the page already shows "Ответ компании". */
  answered: boolean;
  /** A reply already written for it (by the owner or the agent); kept instead of writing one. */
  reply: string | null;
}

/** `reviews-<orgId>.json`: the card's rating and the reviews read from the page. */
export interface YandexReviewSnapshot {
  rating: number | null;
  reviewCount: number | null;
  reviews: YandexReview[];
}

/** One line of `replies-<orgId>.json`. */
export interface YandexReplyEntry {
  key: string;
  author: string | null;
  date: string | null;
  rating: number | null;
  text: string | null;
  reply: string | null;
  /** Set to true by the agent once the reply is posted on Yandex. */
  posted: boolean;
  /** Why no reply could be written. */
  error?: string;
}

export interface YandexReplyFile {
  rating: number | null;
  reviewCount: number | null;
  replies: YandexReplyEntry[];
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const RUSSIAN_MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

/** `2026-11-12` from "12 ноября 2026", "12.11.2026" or an ISO date; null otherwise. */
export function yandexReviewDateIso(value: string | null): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  if (dotted) return `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
  const long = /^(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i.exec(value.trim());
  if (!long) return null;
  const word = long[2].toLocaleLowerCase('ru');
  // "мая" must not match "март"; check longer stems first.
  const month = [...RUSSIAN_MONTHS.entries()].sort((a, b) => b[1].length - a[1].length).find(([, stem]) => word.startsWith(stem))?.[0];
  if (month === undefined) return null;
  return `${long[3]}-${String(month + 1).padStart(2, '0')}-${long[1].padStart(2, '0')}`;
}

const rating = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 5 ? Math.round(parsed) : null;
};
const average = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 5 ? parsed : null;
};
const count = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/\D/g, '') || NaN) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

function reviewKey(author: string | null, date: string | null, body: string | null) {
  return [author ?? 'anonymous', date ?? '', (body ?? '').slice(0, 40)].join('|');
}

/** The saved reviews file: an array of reviews, or `{ rating, reviewCount, reviews }`. Unusable rows are dropped. */
export function parseYandexReviews(json: unknown): YandexReviewSnapshot {
  const root = json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : {};
  const rows = Array.isArray(json) ? json : Array.isArray(root.reviews) ? root.reviews : [];
  const seen = new Set<string>();
  const reviews = rows.flatMap((row): YandexReview[] => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    const author = text(record.author);
    const date = text(record.date);
    const body = text(record.text);
    if (!author && !body && rating(record.rating) === null) return [];
    const key = text(record.key) ?? reviewKey(author, date, body);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, author, date, rating: rating(record.rating), text: body, answered: record.answered === true, reply: text(record.reply) }];
  });
  return { rating: average(root.rating), reviewCount: count(root.reviewCount), reviews };
}

/** The review in Google's shape, so `reviewReplyPrompt` and the reply writer are reused unchanged. */
export function toGoogleShape(review: YandexReview): GoogleReview {
  return {
    name: review.key,
    reviewerName: review.author,
    starRating: review.rating,
    comment: review.text,
    createTime: yandexReviewDateIso(review.date),
    hasReply: review.answered,
  };
}

/** The saved replies file, or an empty one for anything unusable. */
export function parseYandexReplies(json: unknown): YandexReplyFile {
  const root = json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : {};
  const rows = Array.isArray(root.replies) ? root.replies : [];
  const replies = rows.flatMap((row): YandexReplyEntry[] => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    const key = text(record.key);
    if (!key) return [];
    return [{
      key,
      author: text(record.author),
      date: text(record.date),
      rating: rating(record.rating),
      text: text(record.text),
      reply: text(record.reply),
      posted: record.posted === true,
      ...(text(record.error) ? { error: text(record.error)! } : {}),
    }];
  });
  return { rating: average(root.rating), reviewCount: count(root.reviewCount), replies };
}

export type YandexReplyWriter = (review: GoogleReview, clubName: string) => Promise<string | null>;

/**
 * A reply for every unanswered review, oldest first. A reply already in the
 * reviews file or in the earlier replies file is kept (with its `posted`
 * mark), so the agent can write or edit replies and a rerun never rewrites
 * one. `write` is null when no model is configured; reviews then get an error.
 */
export async function buildYandexReplies(
  snapshot: YandexReviewSnapshot,
  previous: YandexReplyFile | null,
  clubName: string,
  write: YandexReplyWriter | null,
): Promise<YandexReplyFile> {
  const earlier = new Map((previous?.replies ?? []).map((entry) => [entry.key, entry]));
  const pending = snapshot.reviews
    .filter((review) => !review.answered)
    .sort((a, b) => (yandexReviewDateIso(a.date) ?? '').localeCompare(yandexReviewDateIso(b.date) ?? ''));
  const replies: YandexReplyEntry[] = [];
  for (const review of pending) {
    const base = { key: review.key, author: review.author, date: review.date, rating: review.rating, text: review.text };
    const kept = earlier.get(review.key);
    const keptReply = review.reply ?? kept?.reply ?? null;
    if (keptReply) {
      replies.push({ ...base, reply: keptReply, posted: kept?.reply === keptReply ? kept.posted : false });
      continue;
    }
    if (!write) {
      replies.push({ ...base, reply: null, posted: false, error: 'No AI model is configured' });
      continue;
    }
    try {
      const reply = await write(toGoogleShape(review), clubName);
      replies.push(reply ? { ...base, reply, posted: false } : { ...base, reply: null, posted: false, error: 'The model returned no reply' });
    } catch (error) {
      replies.push({ ...base, reply: null, posted: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { rating: snapshot.rating, reviewCount: snapshot.reviewCount, replies };
}
