import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { PriceCardContent } from './priceCard';
import { buildPriceCardSvg, fitHeadline, priceCardPrice, PRICE_CARD_SIZE, renderPriceCardPng, textWidth } from './priceCardImage';

const card = (overrides: Partial<PriceCardContent> = {}): PriceCardContent => ({
  itemId: 'o1', brand: 'PIXEL GAMING', logoUrl: null, label: 'Стандарт', headline: '7 часов', timeWindow: null,
  price: 60000, background: null, version: 'abcd1234', ...overrides,
});

/** Every `<text>` line's font size and content, for checking that each fits the card. */
function textLines(svg: string) {
  return [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map((match) => ({
    size: Number(/font-size="([\d.]+)"/.exec(match[1])![1]),
    spacing: Number(/letter-spacing="([\d.]+)"/.exec(match[1])?.[1] ?? 0),
    text: match[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  }));
}

describe('fitHeadline', () => {
  it('keeps a short package on one big line', () => {
    expect(fitHeadline('7 часов')).toMatchObject({ lines: ['7 ЧАСОВ'] });
    expect(fitHeadline('7 часов').fontSize).toBeGreaterThanOrEqual(150);
    expect(fitHeadline('2+1 часа').lines).toEqual(['2+1 ЧАСА']);
  });

  it('wraps the longest real names without leaving a plus at a line end', () => {
    const fitted = fitHeadline('3+2 часа + сеты ZarKebab');
    expect(fitted.lines).toEqual(['3+2 ЧАСА', '+ СЕТЫ', 'ZARKEBAB']);
    for (const line of fitted.lines) expect(textWidth(line, fitted.fontSize)).toBeLessThanOrEqual(880);
    expect(fitHeadline('Ночной пакет').lines).toEqual(['НОЧНОЙ', 'ПАКЕТ']);
  });

  it('shrinks and then cuts a text too long for three lines', () => {
    const fitted = fitHeadline('Комбо: 3+2 часа + сеты ZarKebab и напиток на выбор бесплатно для всех гостей клуба каждый день');
    expect(fitted.lines.length).toBeLessThanOrEqual(3);
    expect(fitted.lines[fitted.lines.length - 1].endsWith('…')).toBe(true);
    for (const line of fitted.lines) expect(textWidth(line, fitted.fontSize)).toBeLessThanOrEqual(880);
  });

  it('honours a smaller height', () => {
    const fitted = fitHeadline('Дневной пакет', 880, 260);
    expect(fitted.lines.length * fitted.lineHeight).toBeLessThanOrEqual(260);
  });
});

describe('buildPriceCardSvg', () => {
  it('draws the brand, zone, package, time window and price', () => {
    const svg = buildPriceCardSvg(card({ timeWindow: '06:00–18:00' }));
    const texts = textLines(svg).map((line) => line.text);
    expect(texts).toEqual(expect.arrayContaining(['PIXEL GAMING', 'СТАНДАРТ', '7 ЧАСОВ', '06:00–18:00', priceCardPrice(60000)]));
    expect(priceCardPrice(60000)).toBe('60 000 сум');
    expect(svg).toContain(`viewBox="0 0 ${PRICE_CARD_SIZE} ${PRICE_CARD_SIZE}"`);
    // No picture: the brand gradient instead.
    expect(svg).toContain('url(#glow)');
    expect(svg).not.toContain('<image');
  });

  it('puts a cover behind a dark overlay and the logo in a circle', () => {
    const svg = buildPriceCardSvg(card(), { background: 'data:image/jpeg;base64,AAAA', logo: 'data:image/jpeg;base64,BBBB' });
    expect(svg).toContain('<image href="data:image/jpeg;base64,AAAA"');
    expect(svg).toContain('clip-path="url(#logo)"');
    expect(svg).not.toContain('url(#glow)');
  });

  it('keeps every line inside the card for long labels, prices and headlines', () => {
    const svg = buildPriceCardSvg(card({
      label: 'PlayStation 5 Pro Ультра зона для турниров', headline: 'Комбо: 3+2 часа + сеты ZarKebab', timeWindow: '22:00–08:00', price: 12500000,
    }));
    const lines = textLines(svg);
    for (const line of lines) expect(textWidth(line.text, line.size, line.spacing)).toBeLessThanOrEqual(880);
    expect(lines.some((line) => line.text.endsWith('…') && line.text.startsWith('PLAYSTATION 5'))).toBe(true);
    const baselines = [...svg.matchAll(/<text [^>]*y="(\d+(?:\.\d+)?)"/g)].map((match) => Number(match[1]));
    expect(Math.min(...baselines)).toBeGreaterThan(60);
    expect(Math.max(...baselines)).toBeLessThan(PRICE_CARD_SIZE - 60);
  });

  it('escapes text and drops what the font cannot draw', () => {
    const svg = buildPriceCardSvg(card({ headline: 'Пицца & кола 🍕', label: '<VIP>' }));
    expect(svg).toContain('&amp; КОЛА');
    expect(svg).toContain('&lt;VIP&gt;');
    expect(svg).not.toContain('🍕');
  });
});

describe('renderPriceCardPng', () => {
  it('renders a 1080 square PNG, with or without pictures', async () => {
    const plain = await renderPriceCardPng(card());
    expect(plain.subarray(1, 4).toString()).toBe('PNG');
    expect(await sharp(plain).metadata()).toMatchObject({ width: PRICE_CARD_SIZE, height: PRICE_CARD_SIZE });
    const cover = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#a33' } }).jpeg().toBuffer();
    const pictured = await renderPriceCardPng(card(), { background: cover, logo: cover });
    expect(await sharp(pictured).metadata()).toMatchObject({ width: PRICE_CARD_SIZE, height: PRICE_CARD_SIZE });
    // A file Sharp cannot read is left out rather than failing the card.
    const broken = await renderPriceCardPng(card(), { background: Buffer.from('not an image'), logo: null });
    expect(broken.subarray(1, 4).toString()).toBe('PNG');
  });
});
