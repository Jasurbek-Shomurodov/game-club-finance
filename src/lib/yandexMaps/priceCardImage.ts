// The branded 1080×1080 price card behind every Yandex Maps price-list item:
// a dark navy square with a soft neon frame, the club logo and wordmark on
// top, the zone as a small label, the package in large bold capitals, the
// time window, and the price in a pill. A game cover, when there is one, sits
// behind it all under a dark overlay. Colours are the report images' palette.
// The SVG builder and the text fitting are pure; only the PNG render touches
// Sharp and the bundled report fonts.

import '@/lib/telegram/reportFontConfig';
import sharp from 'sharp';
import { formatCurrency } from '@/lib/formatters';
import { drawableText, escapeXml, REVIEW_DIGEST_COLORS as COLORS } from '@/lib/googleBusiness/reviewDigestImage';
import type { PriceCardContent } from './priceCard';

export const PRICE_CARD_SIZE = 1080;
const CENTER = PRICE_CARD_SIZE / 2;
/** Text keeps clear of the frame by this much on each side. */
const TEXT_WIDTH = 880;
const HEADLINE_MAX_SIZE = 184;
/** A headline that fits on one line at this size or larger stays on one line. */
const HEADLINE_ONE_LINE_MIN_SIZE = 124;
const HEADLINE_MIN_SIZE = 64;
const HEADLINE_MAX_LINES = 3;
const HEADLINE_MAX_HEIGHT = 400;
const LOGO_SIZE = 104;

/**
 * Glyph widths of the bundled Noto Sans Bold, in em, measured from the
 * renderer itself; uppercase letters not listed are 0.72em.
 */
const GLYPH_WIDTHS: Record<string, number> = {
  ' ': 0.26, '0': 0.56, '1': 0.51, '2': 0.56, '3': 0.56, '4': 0.56, '5': 0.56, '6': 0.56, '7': 0.56, '8': 0.56, '9': 0.56,
  'Г': 0.58, 'Д': 0.74, 'Е': 0.67, 'Ё': 0.67, 'Ж': 1, 'З': 0.67, 'М': 0.83, 'О': 0.78, 'Р': 0.67, 'Т': 0.61, 'У': 0.67,
  'Ф': 0.83, 'Х': 0.67, 'Ц': 0.74, 'Ч': 0.67, 'Ш': 0.94, 'Щ': 0.96, 'Ъ': 0.83, 'Ы': 0.94, 'Ь': 0.67, 'Ю': 1, 'Я': 0.73,
  'E': 0.67, 'F': 0.61, 'G': 0.78, 'I': 0.28, 'J': 0.56, 'L': 0.61, 'M': 0.83, 'O': 0.78, 'P': 0.67, 'Q': 0.78, 'S': 0.67,
  'T': 0.61, 'V': 0.67, 'W': 0.94, 'X': 0.67, 'Y': 0.67, 'Z': 0.61,
  '+': 0.58, ':': 0.33, '–': 0.56, '—': 0.9, '-': 0.33, '.': 0.28, ',': 0.28, '(': 0.33, ')': 0.33, '/': 0.38, '«': 0.55, '»': 0.55,
};

/** Width in px of `text` at `fontSize`, with `letterSpacing` px between glyphs. Errs a little wide. */
export function textWidth(text: string, fontSize: number, letterSpacing = 0): number {
  const glyphs = [...text];
  const em = glyphs.reduce((sum, glyph) => sum + (GLYPH_WIDTHS[glyph] ?? (glyph === glyph.toLocaleLowerCase('ru') ? 0.6 : 0.72)), 0);
  return em * fontSize * 1.03 + Math.max(0, glyphs.length - 1) * letterSpacing;
}

export interface FittedHeadline {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

/** Greedy word wrap at `fontSize`; a word wider than the line stays on a line of its own. */
function wrapWords(words: readonly string[], fontSize: number, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || textWidth(candidate, fontSize) <= width) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * The headline in capitals at the largest size that fits the card: up to
 * three lines, no line wider than the text area. A text too long even at the
 * smallest size is cut with an ellipsis.
 */
export function fitHeadline(headline: string, width = TEXT_WIDTH, maxHeight = HEADLINE_MAX_HEIGHT): FittedHeadline {
  // A lone "+" or dash stays with the word after it, so no line ends on one.
  const words = drawableText(headline).toLocaleUpperCase('ru').split(' ').filter(Boolean)
    .reduce<string[]>((joined, word) => {
      const previous = joined[joined.length - 1];
      if (previous && /^[+–—&-]$/.test(previous)) joined[joined.length - 1] = `${previous} ${word}`;
      else joined.push(word);
      return joined;
    }, []);
  if (!words.length) return { lines: [], fontSize: HEADLINE_MAX_SIZE, lineHeight: HEADLINE_MAX_SIZE };
  const oneLine = words.join(' ');
  for (let fontSize = HEADLINE_MAX_SIZE; fontSize >= HEADLINE_ONE_LINE_MIN_SIZE; fontSize -= 4) {
    if (textWidth(oneLine, fontSize) <= width) return { lines: [oneLine], fontSize, lineHeight: Math.round(fontSize * 1.04) };
  }
  for (let fontSize = HEADLINE_MAX_SIZE; fontSize >= HEADLINE_MIN_SIZE; fontSize -= 4) {
    const lineHeight = Math.round(fontSize * 1.04);
    const lines = wrapWords(words, fontSize, width);
    if (lines.length <= HEADLINE_MAX_LINES && lines.length * lineHeight <= maxHeight && lines.every((line) => textWidth(line, fontSize) <= width)) {
      return { lines, fontSize, lineHeight };
    }
  }
  const fontSize = HEADLINE_MIN_SIZE;
  const lines = wrapWords(words, fontSize, width).slice(0, HEADLINE_MAX_LINES).map((line) => {
    let cut = line;
    while (textWidth(cut, fontSize) > width && cut.length > 1) cut = [...cut].slice(0, -1).join('');
    return cut;
  });
  const last = lines.length - 1;
  let ending = `${lines[last]}…`;
  while (textWidth(ending, fontSize) > width && ending.length > 2) ending = `${[...ending].slice(0, -2).join('').trimEnd()}…`;
  lines[last] = ending;
  return { lines, fontSize, lineHeight: Math.round(fontSize * 1.04) };
}

/**
 * One line of `text` at the largest size up to `max` that fits `width`, the
 * letter spacing scaled with it; cut with an ellipsis when even `min` is too wide.
 */
function fitLine(text: string, max: number, min: number, width: number, letterSpacing = 0): { text: string; size: number; spacing: number } {
  for (let size = max; size > min; size -= 2) {
    const spacing = letterSpacing * (size / max);
    if (textWidth(text, size, spacing) <= width) return { text, size, spacing };
  }
  const spacing = letterSpacing * (min / max);
  let cut = text;
  while (textWidth(cut, min, spacing) > width && cut.length > 1) cut = `${[...cut].slice(0, -2).join('').trimEnd()}…`;
  return { text: cut, size: min, spacing };
}

/** "60 000 сум". */
export function priceCardPrice(price: number): string {
  return `${formatCurrency(price).replace(/[  ]/g, ' ')} сум`;
}

export interface PriceCardImages {
  /** The background cover, already cropped to the square, as a data URL. */
  background: string | null;
  /** The club logo, as a data URL. */
  logo: string | null;
}

/** The whole card as SVG. Images come in as data URLs so the SVG is self-contained. */
export function buildPriceCardSvg(card: PriceCardContent, images: PriceCardImages = { background: null, logo: null }): string {
  const size = PRICE_CARD_SIZE;

  // Header: logo and wordmark, centred together.
  const { text: brand, size: brandSize, spacing: brandSpacing } = fitLine(drawableText(card.brand) || 'PIXEL GAMING', 44, 28, TEXT_WIDTH - (images.logo ? LOGO_SIZE + 24 : 0), 5);
  const brandWidth = textWidth(brand, brandSize, brandSpacing);
  const headerWidth = (images.logo ? LOGO_SIZE + 24 : 0) + brandWidth;
  const headerX = CENTER - headerWidth / 2;
  const headerY = 132;

  // Price pill at the bottom.
  const { text: price, size: priceSize } = fitLine(priceCardPrice(card.price), 88, 52, TEXT_WIDTH - 120);
  const pillWidth = Math.min(TEXT_WIDTH, textWidth(price, priceSize) + 120);
  const pillHeight = Math.round(priceSize * 1.55);
  const pillTop = 948 - pillHeight;

  // Body: label, headline and time window, centred between header and price.
  const areaTop = headerY + LOGO_SIZE / 2 + 44;
  const areaBottom = pillTop - 40;
  const { text: label, size: labelSize, spacing: labelSpacing } = fitLine(drawableText(card.label).toLocaleUpperCase('ru'), 72, 40, TEXT_WIDTH, 8);
  const labelGap = 30;
  const { text: timeWindow, size: timeSize } = fitLine(drawableText(card.timeWindow), 62, 36, TEXT_WIDTH, 2);
  const timeGap = 28;
  const reserved = (label ? labelSize + labelGap : 0) + (timeWindow ? timeGap + timeSize : 0);
  const headline = fitHeadline(card.headline, TEXT_WIDTH, Math.min(HEADLINE_MAX_HEIGHT, areaBottom - areaTop - reserved));
  const headlineHeight = headline.lines.length * headline.lineHeight;
  const bodyHeight = reserved + headlineHeight;
  const bodyTop = (areaTop + areaBottom) / 2 - bodyHeight / 2;
  const labelBaseline = bodyTop + labelSize * 0.8;
  const headlineTop = bodyTop + (label ? labelSize + labelGap : 0);
  // Capitals sit about 0.73em above the baseline; centre each line's capitals in its line box.
  const headlineBaseline = (index: number) => headlineTop + index * headline.lineHeight + (headline.lineHeight + headline.fontSize * 0.72) / 2;
  const timeBaseline = headlineTop + headlineHeight + timeGap + timeSize * 0.78;

  const backdrop = images.background
    ? `<image href="${images.background}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${size}" height="${size}" fill="${COLORS.brand}" fill-opacity="0.7"/>
  <rect width="${size}" height="${size}" fill="url(#shade)"/>`
    : `<rect width="${size}" height="${size}" fill="${COLORS.brand}"/>
  <rect width="${size}" height="${size}" fill="url(#glow)"/>
  <rect width="${size}" height="${size}" fill="url(#shade)"/>`;

  const logo = images.logo
    ? `<circle cx="${headerX + LOGO_SIZE / 2}" cy="${headerY}" r="${LOGO_SIZE / 2 + 4}" fill="${COLORS.accent}" fill-opacity="0.9"/>
  <image href="${images.logo}" x="${headerX}" y="${headerY - LOGO_SIZE / 2}" width="${LOGO_SIZE}" height="${LOGO_SIZE}" preserveAspectRatio="xMidYMid slice" clip-path="url(#logo)"/>`
    : '';
  const brandX = headerX + (images.logo ? LOGO_SIZE + 24 : 0);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.75">
      <stop offset="0" stop-color="${COLORS.badge}" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="${COLORS.badge}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${COLORS.badge}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="black" stop-opacity="0.35"/>
      <stop offset="0.45" stop-color="black" stop-opacity="0.05"/>
      <stop offset="1" stop-color="black" stop-opacity="0.55"/>
    </linearGradient>
    <filter id="neon" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="lift" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
    <clipPath id="logo"><circle cx="${headerX + LOGO_SIZE / 2}" cy="${headerY}" r="${LOGO_SIZE / 2}"/></clipPath>
  </defs>
  ${backdrop}
  <rect x="34" y="34" width="${size - 68}" height="${size - 68}" rx="44" fill="none" stroke="${COLORS.accent}" stroke-width="10" stroke-opacity="0.55" filter="url(#neon)"/>
  <rect x="34" y="34" width="${size - 68}" height="${size - 68}" rx="44" fill="none" stroke="${COLORS.accent}" stroke-width="4"/>
  <g font-family="Noto Sans" text-anchor="middle">
  ${logo}
  <text x="${brandX}" y="${headerY + brandSize * 0.36}" text-anchor="start" font-size="${brandSize}" font-weight="800" letter-spacing="${brandSpacing.toFixed(1)}" fill="white">${escapeXml(brand)}</text>
  ${label ? `<text x="${CENTER}" y="${labelBaseline.toFixed(1)}" font-size="${labelSize}" font-weight="700" letter-spacing="${labelSpacing.toFixed(1)}" fill="${COLORS.accent}">${escapeXml(label)}</text>` : ''}
  <g fill="black" fill-opacity="0.45" filter="url(#lift)">
  ${headline.lines.map((line, index) => `<text x="${CENTER}" y="${(headlineBaseline(index) + 4).toFixed(1)}" font-size="${headline.fontSize}" font-weight="800">${escapeXml(line)}</text>`).join('')}
  </g>
  ${headline.lines.map((line, index) => `<text x="${CENTER}" y="${headlineBaseline(index).toFixed(1)}" font-size="${headline.fontSize}" font-weight="800" fill="white">${escapeXml(line)}</text>`).join('\n  ')}
  ${timeWindow ? `<text x="${CENTER}" y="${timeBaseline.toFixed(1)}" font-size="${timeSize}" font-weight="700" letter-spacing="${(2 * timeSize / 62).toFixed(1)}" fill="${COLORS.bar}">${escapeXml(timeWindow)}</text>` : ''}
  <rect x="${CENTER - pillWidth / 2}" y="${pillTop}" width="${pillWidth}" height="${pillHeight}" rx="${pillHeight / 2}" fill="${COLORS.accent}"/>
  <text x="${CENTER}" y="${(pillTop + pillHeight / 2 + priceSize * 0.36).toFixed(1)}" font-size="${priceSize}" font-weight="800" fill="${COLORS.brand}">${escapeXml(price)}</text>
  </g>
</svg>`;
}

/** Raw image bytes the card draws: a cover (any size) and the logo. */
export interface PriceCardImageBytes {
  background: Buffer | null;
  logo: Buffer | null;
}

/** An image as a square JPEG data URL of `size`; null when Sharp cannot read it. */
async function squareDataUrl(bytes: Buffer | null, size: number, blur = 0): Promise<string | null> {
  if (!bytes) return null;
  try {
    const image = sharp(bytes, { density: 144 }).resize(size, size, { fit: 'cover' }).flatten({ background: COLORS.brand });
    // A soft blur keeps the cover recognisable but quiet behind the text.
    const jpeg = await (blur ? image.blur(blur) : image).jpeg({ quality: 86 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function renderPriceCardPng(card: PriceCardContent, bytes: PriceCardImageBytes = { background: null, logo: null }): Promise<Buffer> {
  const [background, logo] = await Promise.all([squareDataUrl(bytes.background, PRICE_CARD_SIZE, 4), squareDataUrl(bytes.logo, LOGO_SIZE * 2)]);
  return sharp(Buffer.from(buildPriceCardSvg(card, { background, logo }))).png({ compressionLevel: 9 }).toBuffer();
}
