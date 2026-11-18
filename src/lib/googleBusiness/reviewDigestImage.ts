// The daily "AI bot" image sent to a club's Telegram group after the Google
// Maps review-reply run: rating, review count, and each review with the reply
// the bot posted. Russian, like the other Telegram reports. The block and SVG
// builders are pure; only the PNG render touches Sharp and the bundled fonts.

import '@/lib/telegram/reportFontConfig';
import sharp from 'sharp';
import type { ReviewReplyResult } from './reviewReplies';

/** What one club's day looks like, saved in `google_review_digests`. */
export interface ReviewDigest {
  /** Club business date, ISO `YYYY-MM-DD`. */
  digestDate: string;
  clubName: string;
  address: string | null;
  averageRating: number | null;
  totalReviewCount: number | null;
  replied: number;
  failed: number;
  /** Reviews still waiting after this run (the per-run cap or time ran out). */
  remaining: number;
  error: string | null;
  results: ReviewReplyResult[];
}

/** The previous digest's numbers, for the "за сутки" deltas. */
export interface ReviewDigestPrevious {
  averageRating: number | null;
  totalReviewCount: number | null;
}

const WIDTH = 1200;
const CARD_X = 40;
const PAD = 56;
const INNER = WIDTH - CARD_X * 2 - PAD * 2;
const HEADER_HEIGHT = 190;
const MAX_REVIEWS = 8;
const COLORS = {
  page: '#EEF2FB', card: '#FFFFFF', brand: '#0F1E4A', accent: '#7DD3FC', ink: '#0F1E4A', text: '#334155',
  muted: '#64748B', faint: '#94A3B8', rule: '#E2E8F0', tile: '#F5F7FC', intro: '#E8EEFF', badge: '#2563EB',
  good: '#15803D', warn: '#B45309', bad: '#DC2626', star: '#F5A524', bar: '#93C5FD',
};

const ERROR_TEXT: Record<string, string> = {
  RECONNECT: 'доступ к Google истёк, владельцу нужно заново подключить Google Maps',
  QUOTA: 'Google не одобрил доступ к API или исчерпан дневной лимит',
  FORBIDDEN: 'Google отказал в доступе к профилю',
};

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function signed(value: number, digits = 0) {
  const fixed = Math.abs(value).toFixed(digits).replace('.', ',');
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${fixed}`;
}

/** `18 ноября 2026` for an ISO date, without the trailing "г.". */
export function russianLongDate(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(date).replace(/\s*г\.$/, '');
}

/**
 * Noto Sans draws Latin (with Uzbek ʻ ʼ), Cyrillic and common punctuation.
 * Emoji and other scripts are dropped instead of showing as boxes.
 */
export function drawableText(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/[^ -ɏʰ-˿̀-ͯЀ-ӿ‐-‧‰-›№→]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text that is mostly undrawable (Chinese, Arabic…) would read as a misleading fragment. */
function mostlyDrawable(value: string | null | undefined) {
  const original = String(value ?? '').replace(/\s+/g, '');
  return !original || drawableText(value).replace(/\s+/g, '').length >= original.length * 0.6;
}

function wrap(value: string, fontSize: number, width: number, maxLines = Infinity) {
  // Noto Sans averages ~0.55em per glyph across Latin and Cyrillic.
  const perLine = Math.max(8, Math.floor(width / (fontSize * 0.55)));
  const lines: string[] = [];
  let current = '';
  for (const word of drawableText(value).split(' ').filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if ([...candidate].length <= perLine) { current = candidate; continue; }
    if (current) lines.push(current);
    current = [...word].length > perLine ? [...word].slice(0, perLine).join('') : word;
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${[...kept[maxLines - 1]].slice(0, perLine - 1).join('').replace(/[\s,.;:]+$/, '')}…`;
    return kept;
  }
  return lines;
}

type Tone = 'good' | 'warn' | 'bad' | null;
type Tile = { label: string; value: string; sub: string; tone?: Tone };
export type ReviewDigestBlock =
  | { type: 'intro'; title: string; text: string }
  | { type: 'tiles'; tiles: Tile[] }
  | { type: 'heading'; text: string }
  | { type: 'line' | 'note'; text: string; tone?: Tone }
  | ({ type: 'review' } & ReviewReplyResult);

/** Turns the day's digest (and the previous one, for deltas) into drawable blocks. */
export function buildReviewDigestBlocks(digest: ReviewDigest, previous: ReviewDigestPrevious | null = null): ReviewDigestBlock[] {
  const blocks: ReviewDigestBlock[] = [{
    type: 'intro',
    title: 'Привет! Я ИИ-бот Pixel Gaming',
    text: 'Каждый день я сам веду наш профиль на Google Maps: читаю новые отзывы гостей и отвечаю каждому на его языке. Вот что я сделал.',
  }];

  const { averageRating: rating, totalReviewCount: total, results } = digest;
  const handled = results.length + digest.remaining;
  const ratingSub = rating !== null && previous?.averageRating != null
    ? (Math.abs(rating - previous.averageRating) >= 0.05 ? `${signed(rating - previous.averageRating, 1)} за сутки` : 'без изменений')
    : 'на Google Maps';
  const totalSub = total !== null && previous?.totalReviewCount != null ? `${signed(total - previous.totalReviewCount)} за сутки` : 'на Google Maps';
  blocks.push({ type: 'tiles', tiles: [
    { label: 'Рейтинг', value: rating !== null ? rating.toFixed(1).replace('.', ',') : '—', sub: ratingSub },
    { label: 'Отзывов всего', value: total !== null ? String(total) : '—', sub: totalSub },
    { label: 'Ответов отправлено', value: String(digest.replied), sub: `из ${handled} ${plural(handled, 'нового', 'новых', 'новых')}`, tone: digest.replied ? 'good' : null },
    { label: 'Ждут ответа', value: String(digest.remaining + digest.failed), sub: digest.remaining + digest.failed ? 'повтор завтра' : 'всё отвечено', tone: digest.remaining + digest.failed ? 'warn' : null },
  ] });

  blocks.push({ type: 'heading', text: 'Отзывы' });
  if (digest.error) {
    blocks.push({ type: 'line', text: `Ошибка: ${ERROR_TEXT[digest.error] ?? 'не удалось прочитать отзывы, повтор завтра'}.`, tone: 'bad' });
  }
  if (!results.length && !digest.error) {
    blocks.push({ type: 'line', text: digest.remaining ? 'Сегодня не успел ответить: продолжу завтра.' : 'Новых отзывов без ответа нет: на все отзывы уже есть ответ.' });
  }
  for (const result of results.slice(0, MAX_REVIEWS)) blocks.push({ type: 'review', ...result });
  if (results.length > MAX_REVIEWS) blocks.push({ type: 'note', text: `…и ещё ${results.length - MAX_REVIEWS}` });
  if (digest.remaining) {
    blocks.push({ type: 'note', text: `Ещё ${digest.remaining} ${plural(digest.remaining, 'отзыв ждёт', 'отзыва ждут', 'отзывов ждут')} ответа: отвечу в следующие дни.`, tone: 'warn' });
  }
  if (digest.failed) {
    blocks.push({ type: 'note', text: `${digest.failed} ${plural(digest.failed, 'ответ не удалось', 'ответа не удалось', 'ответов не удалось')} отправить: повтор завтра.`, tone: 'warn' });
  }
  return blocks;
}

const toneColor = (tone: Tone | undefined) => (tone ? COLORS[tone] : COLORS.ink);

function starPath(cx: number, cy: number, r: number) {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 ? r * 0.45 : r;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`);
  }
  return `M${points.join('L')}Z`;
}

function stars(x: number, y: number, rating: number, r = 13) {
  return Array.from({ length: 5 }, (_, i) =>
    `<path d="${starPath(x + r + i * (r * 2 + 6), y - r + 2, r)}" fill="${i < rating ? COLORS.star : COLORS.rule}"/>`).join('');
}

function layout(blocks: ReviewDigestBlock[], x: number) {
  const parts: string[] = [];
  let y = 0;
  for (const block of blocks) {
    if (block.type === 'intro') {
      const lines = wrap(block.text, 24, INNER - 64);
      const boxHeight = 86 + lines.length * 34 + 22;
      parts.push(`<rect x="${x}" y="${y}" width="${INNER}" height="${boxHeight}" rx="20" fill="${COLORS.intro}"/>`);
      parts.push(`<rect x="${x + 32}" y="${y + 28}" width="96" height="34" rx="17" fill="${COLORS.badge}"/>`);
      parts.push(`<text x="${x + 80}" y="${y + 52}" text-anchor="middle" font-size="19" font-weight="700" letter-spacing="1" fill="white">ИИ-БОТ</text>`);
      parts.push(`<text x="${x + 146}" y="${y + 54}" font-size="28" font-weight="700" fill="${COLORS.ink}">${escapeXml(block.title)}</text>`);
      lines.forEach((line, i) => parts.push(`<text x="${x + 32}" y="${y + 108 + i * 34}" font-size="24" fill="${COLORS.text}">${escapeXml(line)}</text>`));
      y += boxHeight + 24;
    } else if (block.type === 'tiles') {
      y += 26;
      const gap = 18;
      const width = (INNER - gap * 3) / 4;
      block.tiles.forEach((tile, i) => {
        const tx = x + i * (width + gap);
        const size = [...tile.value].length > 8 ? 30 : 44;
        parts.push(`<rect x="${tx}" y="${y}" width="${width}" height="150" rx="18" fill="${COLORS.tile}"/>`);
        parts.push(`<text x="${tx + 22}" y="${y + 40}" font-size="21" fill="${COLORS.muted}">${escapeXml(tile.label)}</text>`);
        parts.push(`<text x="${tx + 22}" y="${y + 92}" font-size="${size}" font-weight="700" fill="${toneColor(tile.tone)}">${escapeXml(tile.value)}</text>`);
        if (tile.sub) parts.push(`<text x="${tx + 22}" y="${y + 128}" font-size="19" fill="${COLORS.faint}">${escapeXml(tile.sub)}</text>`);
      });
      y += 170;
    } else if (block.type === 'heading') {
      y += 34;
      parts.push(`<text x="${x}" y="${y + 30}" font-size="24" font-weight="700" letter-spacing="1.5" fill="${COLORS.badge}">${escapeXml(block.text.toLocaleUpperCase('ru'))}</text>`);
      parts.push(`<rect x="${x}" y="${y + 48}" width="${INNER}" height="1.5" fill="${COLORS.rule}"/>`);
      y += 70;
    } else if (block.type === 'review') {
      const published = block.status === 'published';
      parts.push(stars(x, y + 26, block.starRating ?? 0));
      parts.push(`<text x="${x + INNER}" y="${y + 24}" text-anchor="end" font-size="21" font-weight="700" fill="${published ? COLORS.good : COLORS.bad}">${published ? 'Ответ опубликован' : 'Ошибка ответа'}</text>`);
      y += 44;
      const comment = mostlyDrawable(block.comment) ? drawableText(block.comment) : '';
      const commentLines = comment
        ? wrap(`«${comment}»`, 26, INNER, 3)
        : [block.comment ? 'Текст на языке, который картинка не отображает' : 'Без текста, только оценка'];
      for (const line of commentLines) {
        parts.push(`<text x="${x}" y="${y + 26}" font-size="26" fill="${COLORS.ink}"${comment ? '' : ' font-style="italic"'}>${escapeXml(line)}</text>`);
        y += 36;
      }
      const replyText = !block.reply
        ? 'не удалось написать или отправить ответ, повтор завтра'
        : mostlyDrawable(block.reply) ? drawableText(block.reply) : 'на языке отзыва (картинка его не отображает)';
      const replyLines = wrap(`${published ? 'Ответ' : 'Ошибка'}: ${replyText}`, 23, INNER - 24, 4);
      parts.push(`<rect x="${x}" y="${y + 6}" width="4" height="${replyLines.length * 32 + 4}" rx="2" fill="${published ? COLORS.bar : COLORS.bad}"/>`);
      for (const line of replyLines) {
        parts.push(`<text x="${x + 22}" y="${y + 30}" font-size="23" fill="${COLORS.muted}">${escapeXml(line)}</text>`);
        y += 32;
      }
      y += 34;
    } else {
      const fontSize = block.type === 'note' ? 22 : 25;
      const color = block.type === 'note' && !block.tone ? COLORS.muted : toneColor(block.tone);
      for (const line of wrap(block.text, fontSize, INNER)) {
        parts.push(`<text x="${x}" y="${y + 26}" font-size="${fontSize}" fill="${color}">${escapeXml(line)}</text>`);
        y += fontSize + 12;
      }
      y += 8;
    }
  }
  return { svg: parts.join(''), height: y };
}

export function buildReviewDigestSvg(digest: ReviewDigest, previous: ReviewDigestPrevious | null = null) {
  const x = CARD_X + PAD;
  const bodyTop = CARD_X + HEADER_HEIGHT + 36;
  const { svg: body, height: bodyHeight } = layout(buildReviewDigestBlocks(digest, previous), x);
  const footerTop = bodyTop + bodyHeight + 20;
  const cardHeight = footerTop + 70 - CARD_X;
  const height = cardHeight + CARD_X * 2;
  const cardWidth = WIDTH - CARD_X * 2;
  const subtitle = [russianLongDate(digest.digestDate), drawableText(digest.address) || null].filter(Boolean).join(' · ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
  <rect width="${WIDTH}" height="${height}" fill="${COLORS.page}"/>
  <g font-family="Noto Sans">
  <rect x="${CARD_X}" y="${CARD_X}" width="${cardWidth}" height="${cardHeight}" rx="28" fill="${COLORS.card}"/>
  <path d="M${CARD_X} ${CARD_X + HEADER_HEIGHT}V${CARD_X + 28}a28 28 0 0 1 28 -28H${CARD_X + cardWidth - 28}a28 28 0 0 1 28 28V${CARD_X + HEADER_HEIGHT}Z" fill="${COLORS.brand}"/>
  <text x="${x}" y="${CARD_X + 58}" font-size="22" font-weight="700" letter-spacing="3" fill="${COLORS.accent}">${escapeXml(drawableText(digest.clubName).toLocaleUpperCase('ru') || 'PIXEL GAMING')} · GOOGLE MAPS</text>
  <text x="${x}" y="${CARD_X + 118}" font-size="50" font-weight="700" fill="white">Отчёт ИИ-бота за сутки</text>
  <text x="${x}" y="${CARD_X + 160}" font-size="27" fill="white" fill-opacity="0.88">${escapeXml(subtitle)}: отзывы</text>
  <g transform="translate(0 ${bodyTop})">${body}</g>
  <rect x="${x}" y="${footerTop}" width="${INNER}" height="1.5" fill="${COLORS.rule}"/>
  <text x="${x}" y="${footerTop + 44}" font-size="21" fill="${COLORS.faint}">Ответы на отзывы Google Maps каждый день в 08:00 (Ташкент).</text>
  </g></svg>`;
}

export async function renderReviewDigestPng(digest: ReviewDigest, previous: ReviewDigestPrevious | null = null): Promise<Buffer> {
  return sharp(Buffer.from(buildReviewDigestSvg(digest, previous))).png({ compressionLevel: 9 }).toBuffer();
}
