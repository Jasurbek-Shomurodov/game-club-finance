import { describe, expect, it, vi } from 'vitest';
import { reviewDigestCaption, reviewDigestFromOutcome, sendReviewDigest, type ReviewDigestDeps } from './reviewDigest';
import { buildReviewDigestBlocks, buildReviewDigestSvg, drawableText, renderReviewDigestPng, russianLongDate, YANDEX_MAPS_DIGEST_SOURCE, type ReviewDigest } from './reviewDigestImage';
import type { ClubReplyOutcome } from './reviewReplies';

const CLUB = { clubId: 'club-1', clubName: 'Pixel Gaming', address: 'Matbuotchilar 17' };

function outcome(overrides: Partial<ClubReplyOutcome> = {}): ClubReplyOutcome {
  return {
    clubId: 'club-1', replied: 2, failed: 1, remaining: 4, averageRating: 4.8, totalReviewCount: 152,
    results: [
      { starRating: 5, reviewerName: 'Aziz', comment: 'Zoʻr klub, kompyuterlar tez', reply: 'Rahmat, Aziz!', status: 'published' },
      { starRating: 2, reviewerName: null, comment: 'Шумно', reply: 'Извините за шум.', status: 'published' },
      { starRating: 4, reviewerName: null, comment: null, reply: null, status: 'failed' },
    ],
    ...overrides,
  };
}

const digest = (overrides: Partial<ClubReplyOutcome> = {}): ReviewDigest => reviewDigestFromOutcome(CLUB, outcome(overrides), '2026-11-18');

function deps(overrides: Partial<ReviewDigestDeps> = {}): ReviewDigestDeps {
  return {
    chatId: () => '-1001',
    reportPending: vi.fn(async () => false),
    claim: vi.fn(async () => true),
    previous: vi.fn(async () => ({ averageRating: 4.7, totalReviewCount: 150 })),
    render: vi.fn(async () => Buffer.from('png')),
    send: vi.fn(async () => 42),
    complete: vi.fn(async () => undefined),
    log: vi.fn(),
    ...overrides,
  };
}

describe('reviewDigestFromOutcome', () => {
  it('counts failed reviews apart from those left for later', () => {
    expect(digest()).toMatchObject({ replied: 2, failed: 1, remaining: 3, error: null, address: 'Matbuotchilar 17' });
  });
});

describe('buildReviewDigestBlocks', () => {
  it('shows the rating and review count with day-over-day changes', () => {
    const tiles = buildReviewDigestBlocks(digest(), { averageRating: 4.7, totalReviewCount: 150 }).find((b) => b.type === 'tiles');
    expect(tiles).toMatchObject({ tiles: [
      { value: '4,8', sub: '+0,1 за сутки' },
      { value: '152', sub: '+2 за сутки' },
      { value: '2', sub: 'из 6 новых' },
      { value: '4', sub: 'повтор завтра' },
    ] });
  });

  it('says every review already has a reply when nothing was new', () => {
    const blocks = buildReviewDigestBlocks(digest({ replied: 0, failed: 0, remaining: 0, results: [] }));
    expect(blocks).toContainEqual({ type: 'line', text: 'Новых отзывов без ответа нет: на все отзывы уже есть ответ.' });
  });

  it('explains an access error', () => {
    const blocks = buildReviewDigestBlocks(digest({ error: 'RECONNECT', results: [], replied: 0, failed: 0, remaining: 0 }));
    expect(blocks.some((b) => b.type === 'line' && b.tone === 'bad' && b.text.includes('заново подключить'))).toBe(true);
  });
});

describe('buildReviewDigestSvg', () => {
  it('draws the club, address, reviews and replies', () => {
    const svg = buildReviewDigestSvg(digest());
    expect(svg).toContain('PIXEL GAMING · GOOGLE MAPS');
    expect(svg).toContain('18 ноября 2026 · Matbuotchilar 17: отзывы');
    expect(svg).toContain('«Zoʻr klub, kompyuterlar tez»');
    expect(svg).toContain('Ответ: Rahmat, Aziz!');
    expect(svg).toContain('Ошибка ответа');
  });

  it('speaks for Yandex Maps when given its source', () => {
    const svg = buildReviewDigestSvg(digest(), null, YANDEX_MAPS_DIGEST_SOURCE);
    expect(svg).toContain('PIXEL GAMING · ЯНДЕКС КАРТЫ');
    expect(svg).toContain('веду наш профиль на Яндекс Картах');
    expect(svg).toContain('Ответы на отзывы и прайс-лист Яндекс Карт ведёт ИИ-бот.');
    expect(svg).not.toContain('Google');
    expect(buildReviewDigestSvg(digest())).toContain('Ответы на отзывы Google Maps каждый день в 08:00 (Ташкент).');
  });

  it('replaces text the font cannot draw', () => {
    const svg = buildReviewDigestSvg(digest({ results: [{ starRating: 5, reviewerName: null, comment: '非常好的网吧', reply: '谢谢您的评价', status: 'published' }] }));
    expect(svg).toContain('Текст на языке, который картинка не отображает');
    expect(svg).toContain('на языке отзыва (картинка его не отображает)');
  });

  it('escapes review text', () => {
    expect(buildReviewDigestSvg(digest({ results: [{ starRating: 1, reviewerName: null, comment: '<b>&</b>', reply: 'ok', status: 'published' }] })))
      .toContain('«&lt;b&gt;&amp;&lt;/b&gt;»');
  });

  it('renders a PNG', async () => {
    const png = await renderReviewDigestPng(digest());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});

describe('text helpers', () => {
  it('formats the date in Russian and drops emoji', () => {
    expect(russianLongDate('2026-11-18')).toBe('18 ноября 2026');
    expect(drawableText('Super 🔥 joy')).toBe('Super joy');
  });
});

describe('sendReviewDigest', () => {
  it('claims the day, sends the image and records the message', async () => {
    const d = deps();
    await expect(sendReviewDigest(CLUB, digest(), d)).resolves.toBe('sent');
    expect(d.claim).toHaveBeenCalledWith('club-1', digest(), '-1001', false);
    expect(d.send).toHaveBeenCalledWith('-1001', Buffer.from('png'), reviewDigestCaption(digest()), 'google-reviews-2026-11-18.png');
    expect(d.complete).toHaveBeenCalledWith('club-1', '2026-11-18', { messageId: 42 });
  });

  it('leaves the image for the daily report album when that report is still to come', async () => {
    const d = deps({ reportPending: vi.fn(async () => true) });
    await expect(sendReviewDigest(CLUB, digest(), d)).resolves.toBe('queued');
    expect(d.claim).toHaveBeenCalledWith('club-1', digest(), '-1001', true);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.complete).not.toHaveBeenCalled();
  });

  it('sends on its own when the report check fails', async () => {
    const d = deps({ reportPending: async () => { throw new Error('db down'); } });
    await expect(sendReviewDigest(CLUB, digest(), d)).resolves.toBe('sent');
    expect(d.claim).toHaveBeenCalledWith('club-1', digest(), '-1001', false);
  });

  it('skips a club without a Telegram group', async () => {
    const d = deps({ chatId: () => null });
    await expect(sendReviewDigest(CLUB, digest(), d)).resolves.toBe('skipped');
    expect(d.claim).not.toHaveBeenCalled();
  });

  it('never sends the same day twice', async () => {
    const d = deps({ claim: async () => false });
    await expect(sendReviewDigest(CLUB, digest(), d)).resolves.toBe('held');
    expect(d.send).not.toHaveBeenCalled();
  });

  it('records a failed send without retrying it', async () => {
    const d = deps({ send: async () => { throw new Error('Telegram down'); } });
    await expect(sendReviewDigest(CLUB, digest(), d)).resolves.toBe('failed');
    expect(d.complete).toHaveBeenCalledWith('club-1', '2026-11-18', { error: 'Telegram down' });
  });
});
