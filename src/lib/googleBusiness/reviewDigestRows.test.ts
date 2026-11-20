import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./reviewDigestImage', () => ({ renderReviewDigestPng: vi.fn(async () => Buffer.from('png')) }));

const { completeReviewDigest, fetchAwaitingReviewDigest, fetchPreviousReviewDigest } = await import('./reviewDigestRows');
const { loadAwaitingReviewDigestPhoto } = await import('./reviewDigestPhoto');

const ROW = {
  digest_date: '2026-11-21', average_rating: '5.00', total_review_count: 9, replied: 1, failed: 0, remaining: 0,
  error: null, results: [], clubs: { name: 'Pixel Gaming', address: ' Matbuotchilar 17 ' },
};

/** A query builder that records its calls and resolves to `result`. */
function client(results: Array<{ data: unknown; error: unknown }>) {
  const calls: Array<[string, unknown[]]> = [];
  let index = 0;
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'lt', 'order', 'limit', 'update']) {
    builder[method] = (...args: unknown[]) => { calls.push([method, args]); return builder; };
  }
  builder.maybeSingle = () => Promise.resolve(results[index++]);
  builder.then = (resolve: (value: unknown) => unknown) => resolve(results[index++]);
  const supabase = { from: (table: string) => { calls.push(['from', [table]]); return builder; } };
  return { supabase: supabase as unknown as SupabaseClient, calls };
}

describe('review digest rows', () => {
  it('reads the newest digest waiting for the report', async () => {
    const { supabase, calls } = client([{ data: ROW, error: null }]);
    await expect(fetchAwaitingReviewDigest(supabase, 'club-1')).resolves.toMatchObject({
      digestDate: '2026-11-21', clubName: 'Pixel Gaming', address: 'Matbuotchilar 17', averageRating: 5, replied: 1,
    });
    expect(calls).toContainEqual(['eq', ['awaiting_report', true]]);
  });

  it('returns null when nothing waits and throws a read error', async () => {
    await expect(fetchAwaitingReviewDigest(client([{ data: null, error: null }]).supabase, 'club-1')).resolves.toBeNull();
    await expect(fetchAwaitingReviewDigest(client([{ data: null, error: new Error('down') }]).supabase, 'club-1')).rejects.toThrow('down');
  });

  it('reads the previous numbers, or null', async () => {
    const found = client([{ data: { average_rating: '4.90', total_review_count: 8 }, error: null }]);
    await expect(fetchPreviousReviewDigest(found.supabase, 'club-1', '2026-11-21')).resolves.toEqual({ averageRating: 4.9, totalReviewCount: 8 });
    await expect(fetchPreviousReviewDigest(client([{ data: null, error: new Error('x') }]).supabase, 'club-1', '2026-11-21')).resolves.toBeNull();
  });

  it('records a send and stops the digest waiting', async () => {
    const sent = client([{ data: null, error: null }]);
    await completeReviewDigest(sent.supabase, 'club-1', '2026-11-21', { messageId: 7 });
    expect(sent.calls).toContainEqual(['update', [expect.objectContaining({ telegram_message_id: 7, awaiting_report: false })]]);
    const failed = client([{ data: null, error: null }]);
    await completeReviewDigest(failed.supabase, 'club-1', '2026-11-21', { error: 'boom' });
    expect(failed.calls).toContainEqual(['update', [{ send_error: 'boom', awaiting_report: false }]]);
    await expect(completeReviewDigest(client([{ data: null, error: new Error('no') }]).supabase, 'club-1', '2026-11-21', { messageId: 1 })).rejects.toThrow('no');
  });
});

describe('loadAwaitingReviewDigestPhoto', () => {
  it('renders the waiting digest with its captions', async () => {
    const { supabase } = client([{ data: ROW, error: null }, { data: null, error: null }]);
    await expect(loadAwaitingReviewDigestPhoto(supabase, 'club-1')).resolves.toMatchObject({
      digestDate: '2026-11-21',
      png: Buffer.from('png'),
      fileName: 'google-reviews-2026-11-21.png',
      reportLine: '🤖 ИИ-бот: ответов на отзывы Google Maps: 1',
    });
  });

  it('is null when no digest waits', async () => {
    await expect(loadAwaitingReviewDigestPhoto(client([{ data: null, error: null }]).supabase, 'club-1')).resolves.toBeNull();
  });
});
