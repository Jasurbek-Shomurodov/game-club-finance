// The Telegram "AI bot" image and caption of a Yandex Maps sync run: the
// Google digest layout (reviewDigestImage.ts, drawn with the Yandex source),
// filled from `replies-<orgId>.json` and the price-list diff. Pure.

import type { ReviewDigest } from '@/lib/googleBusiness/reviewDigestImage';
import type { YandexPriceDiff } from './priceList';
import { yandexReviewDateIso, type YandexReplyFile } from './reviews';

export interface YandexDigestClub {
  clubName: string;
  address: string | null;
}

/** The price list's change counts, saved by `plan` in `plan-<orgId>.json`. */
export interface YandexPriceDiffCounts {
  /** Items on the uploaded list; null in a plan saved before it was recorded. */
  total: number | null;
  added: number;
  removed: number;
  /** Items whose price changed (a description-only change is not counted). */
  changed: number;
  renamed: number;
}

export function priceDiffCounts(diff: YandexPriceDiff, total: number): YandexPriceDiffCounts {
  return {
    total,
    added: diff.added.length,
    removed: diff.removed.length,
    changed: diff.changed.filter((change) => change.fields.includes('price')).length,
    renamed: diff.renamed.length,
  };
}

/** Newest review first; reviews without a readable date keep their order, after the dated ones. */
function newestFirst<T extends { date: string | null }>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index, iso: yandexReviewDateIso(entry.date) }))
    .sort((a, b) => (a.iso && b.iso ? b.iso.localeCompare(a.iso) : a.iso ? -1 : b.iso ? 1 : 0) || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * A reply counts as sent only once the agent marked it `posted`; one that was
 * written but not posted, or could not be written, shows as failed.
 */
export function yandexReviewDigest(club: YandexDigestClub, replies: YandexReplyFile, digestDate: string): ReviewDigest {
  const results = newestFirst(replies.replies).map((entry) => ({
    starRating: entry.rating,
    reviewerName: entry.author,
    comment: entry.text,
    reply: entry.reply,
    status: entry.posted && entry.reply ? 'published' as const : 'failed' as const,
  }));
  const replied = results.filter((result) => result.status === 'published').length;
  return {
    digestDate,
    clubName: club.clubName,
    address: club.address,
    averageRating: replies.rating,
    totalReviewCount: replies.reviewCount,
    replied,
    failed: results.length - replied,
    remaining: 0,
    error: null,
    results,
  };
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** "Прайс-лист: 14 позиций, новых 2, переименовано 1." — only the parts that are not zero. */
export function priceCaptionLine(price: YandexPriceDiffCounts): string {
  const parts = [
    price.total !== null ? `${price.total} ${plural(price.total, 'позиция', 'позиции', 'позиций')}` : null,
    price.added ? `новых ${price.added}` : null,
    price.removed ? `убрано ${price.removed}` : null,
    price.changed ? `цена изменена ${price.changed}` : null,
    price.renamed ? `переименовано ${price.renamed}` : null,
  ].filter(Boolean);
  return `Прайс-лист: ${parts.length ? parts.join(', ') : 'без изменений'}.`;
}

/** `🤖 ИИ-бот <club> (<address>): отзывы Яндекс Карт за DD.MM.YYYY. Ответов отправлено: N. Прайс-лист: …` */
export function yandexDigestCaption(digest: ReviewDigest, price: YandexPriceDiffCounts | null): string {
  const where = digest.address ? ` (${digest.address})` : '';
  const date = digest.digestDate.split('-').reverse().join('.');
  const priceLine = price ? ` ${priceCaptionLine(price)}` : '';
  return `🤖 ИИ-бот ${digest.clubName}${where}: отзывы Яндекс Карт за ${date}. Ответов отправлено: ${digest.replied}.${priceLine}`;
}

/**
 * The price part of the caption, only once the agent marked the plan
 * `"uploaded": true` after uploading its YML: before that the card has not changed.
 */
export function uploadedPriceCounts(plan: unknown): YandexPriceDiffCounts | null {
  if (!plan || typeof plan !== 'object') return null;
  const record = plan as { uploaded?: unknown; diffCounts?: unknown };
  if (record.uploaded !== true || !record.diffCounts || typeof record.diffCounts !== 'object') return null;
  const counts = record.diffCounts as Record<string, unknown>;
  const whole = (value: unknown) => (Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null);
  const added = whole(counts.added);
  const removed = whole(counts.removed);
  const changed = whole(counts.changed);
  // Plans saved before renames and the total were recorded have neither.
  const renamed = counts.renamed === undefined ? 0 : whole(counts.renamed);
  const total = counts.total === undefined || counts.total === null ? null : whole(counts.total);
  if (added === null || removed === null || changed === null || renamed === null) return null;
  if (total === null && counts.total !== undefined && counts.total !== null) return null;
  return { total, added, removed, changed, renamed };
}

/** The `generatedAt` of a run file (`plan-`, `replies-<orgId>.json`), or null when it has none. */
export function generatedAtOf(file: unknown): string | null {
  const value = file && typeof file === 'object' ? (file as { generatedAt?: unknown }).generatedAt : null;
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

export type YandexReportDecision = 'send' | 'already_sent' | 'stale';

/**
 * Whether `report --confirm-send` may send a club's image: never twice for one
 * business date unless `resend`, and only from run files made on that date
 * (`generatedAt` in the club's business date, `businessDateOf`) so yesterday's
 * replies are not reported as today's.
 */
export function yandexReportDecision(options: {
  alreadySent: boolean;
  resend: boolean;
  digestDate: string;
  /** generatedAt of every run file that exists for the club. */
  generatedAt: ReadonlyArray<string | null>;
  businessDateOf: (instant: Date) => string;
}): YandexReportDecision {
  const fresh = options.generatedAt.every((value) => value !== null && options.businessDateOf(new Date(value)) === options.digestDate);
  if (!fresh) return 'stale';
  if (options.alreadySent && !options.resend) return 'already_sent';
  return 'send';
}
