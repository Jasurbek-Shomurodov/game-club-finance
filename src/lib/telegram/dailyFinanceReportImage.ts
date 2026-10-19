import './reportFontConfig';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { formatCurrency } from '../formatters';
import type { LowStockProduct } from '../calculations/stock';
import {
  BAR_COST_TARGET,
  OTHER_CATEGORY,
  PROFIT_TARGET,
  type AnalysisSankey,
  type IncomeSourceKey,
} from '../calculations/financialAnalysis';
import { layoutSankey } from '../sankeyLayout';
import { RUSSIAN_EXPENSE_CATEGORY_LABELS } from './expenseCategoryLabels';
import type { DailyFinanceIncomePoint, DailyFinancePromoGiveaway, DailyFinanceReportInput } from './dailyFinanceReport';
import { REPORT_FONT_DIRECTORY, REPORT_FONT_FILES } from './reportFontConfig';

const WIDTH = 1200;
const PAGE_X = 40;
const PAGE_WIDTH = WIDTH - PAGE_X * 2;
const INK = '#0F1E4A';
const TEXT = '#334155';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const BLUE = '#2563EB';
const RED = '#DC2626';
const GREEN = '#15803D';
const ORANGE = '#F97316';
const PURPLE = '#7C3AED';
const SLATE = '#334155';
const AMBER = '#D97706';

const RUSSIAN_MONTHS_GENITIVE_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] ?? character);
}

function assertReportFontsAvailable() {
  const missingFonts = REPORT_FONT_FILES.filter(
    (fileName) => !existsSync(join(REPORT_FONT_DIRECTORY, fileName)),
  );

  if (missingFonts.length > 0) {
    throw new Error(`Bundled report fonts are missing: ${missingFonts.join(', ')}`);
  }
}

function amount(value: number): string {
  return formatCurrency(Math.round(value));
}

function money(value: number): string {
  return `${amount(value)} UZS`;
}

/** Large number followed by a smaller "UZS" suffix, as in the dashboard mockup. */
function moneyText(
  x: number,
  y: number,
  value: number,
  size: number,
  color: string,
  anchor: 'start' | 'end' = 'start',
): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="800" fill="${color}">${escapeXml(amount(value))}<tspan font-size="${Math.round(size * 0.55)}" font-weight="700" dx="8">UZS</tspan></text>`;
}

function percentShare(value: number, total: number): string {
  if (total <= 0) return '0%';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format((value / total) * 100)}%`;
}

function changeColor(change: number | null | undefined): string {
  if (change === null || change === undefined || change === 0) return MUTED;
  return change > 0 ? GREEN : RED;
}

/** Month-over-month change with a drawn arrow; the bundled font has no ▲/▼ glyphs. */
function changeBadge(x: number, y: number, change: number | null | undefined, size: number): string {
  const color = changeColor(change);
  if (change === null || change === undefined || change === 0) {
    return `<text x="${x}" y="${y}" font-size="${size}" font-weight="800" fill="${color}">${change === 0 ? '0%' : '—'}</text>`;
  }

  const half = size * 0.36;
  const top = y - size * 0.72;
  const arrow = change > 0
    ? `${x},${y - size * 0.05} ${x + half * 2},${y - size * 0.05} ${x + half},${top}`
    : `${x},${top} ${x + half * 2},${top} ${x + half},${y - size * 0.05}`;
  return `<polygon points="${arrow}" fill="${color}"/>
    <text x="${x + half * 2 + 6}" y="${y}" font-size="${size}" font-weight="800" fill="${color}">${Math.abs(change)}%</text>`;
}

function card(x: number, y: number, width: number, height: number, fill = '#FFFFFF', stroke = BORDER): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="24" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
}

function iconBadge(cx: number, cy: number, radius: number, color: string, glyph: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}"/>
    <g transform="translate(${cx} ${cy}) scale(${radius / 26})" stroke="#FFFFFF" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`;
}

function iconTile(x: number, y: number, size: number, color: string, glyph: string): string {
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.26}" fill="${color}"/>
    <g transform="translate(${x + size / 2} ${y + size / 2}) scale(${size / 52})" stroke="#FFFFFF" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`;
}

// Glyphs are drawn around (0, 0) inside a 52×52 box.
const GLYPH_TREND_UP = '<polyline points="-13,9 -4,0 3,6 13,-6"/><polyline points="5,-6 13,-6 13,2"/>';
const GLYPH_GAMEPAD = '<path d="M-10,-9 H10 C17,-9 20,-2 20,6 C20,13 15,15 11,11 L6,6 H-6 L-11,11 C-15,15 -20,13 -20,6 C-20,-2 -17,-9 -10,-9 Z"/><line x1="-11" y1="-2" x2="-11" y2="4"/><line x1="-14" y1="1" x2="-8" y2="1"/><circle cx="9" cy="-1" r="1.5" fill="#FFFFFF"/><circle cx="13" cy="3" r="1.5" fill="#FFFFFF"/>';
const GLYPH_CUP = '<path d="M-11,-7 H11 L8,15 H-8 Z"/><line x1="-13" y1="-7" x2="13" y2="-7"/><path d="M2,-7 L6,-17 L11,-17"/>';
const GLYPH_WALLET = '<rect x="-14" y="-10" width="28" height="22" rx="4"/><path d="M4,-3 H14 V6 H4 Z"/><path d="M-10,-10 L6,-16 L8,-10"/>';
const GLYPH_BARS = '<line x1="-10" y1="12" x2="-10" y2="2"/><line x1="0" y1="12" x2="0" y2="-5"/><line x1="10" y1="12" x2="10" y2="-12"/>';
const GLYPH_BOX = '<path d="M0,-15 L14,-7 V9 L0,17 L-14,9 V-7 Z"/><polyline points="-14,-7 0,1 14,-7"/><line x1="0" y1="1" x2="0" y2="17"/>';
const GLYPH_ALERT = '<circle cx="0" cy="0" r="14"/><line x1="0" y1="-7" x2="0" y2="2"/><circle cx="0" cy="8" r="1" fill="#FFFFFF"/>';

function leaderRow(
  x: number,
  right: number,
  y: number,
  label: string,
  value: number,
  color: string,
  outlined = false,
  indent = 0,
): string {
  const dot = outlined
    ? `<circle cx="${x + 7 + indent}" cy="${y - 7}" r="6" fill="#FFFFFF" stroke="${color}" stroke-width="3"/>`
    : `<circle cx="${x + 7 + indent}" cy="${y - 7}" r="6" fill="${color}"/>`;
  const valueText = money(value);
  const labelEnd = x + 26 + indent + label.length * 12.5 + 12;
  const valueStart = right - valueText.length * 13.5 - 12;
  const leader = valueStart > labelEnd
    ? `<line x1="${labelEnd}" y1="${y - 6}" x2="${valueStart}" y2="${y - 6}" stroke="${BORDER}" stroke-width="2"/>`
    : '';

  return `${dot}
    <text x="${x + 26 + indent}" y="${y}" font-size="${indent ? 19 : 21}" font-weight="400" fill="${indent ? MUTED : TEXT}">${escapeXml(label)}</text>
    ${leader}
    <text x="${right}" y="${y}" text-anchor="end" font-size="${indent ? 19 : 21}" font-weight="700" fill="${indent ? MUTED : INK}">${escapeXml(valueText)}</text>`;
}

function limitCategories(
  categories: DailyFinanceReportInput['gameClubExpenseCategories'],
  limit: number,
) {
  if (categories.length <= limit) return categories;

  return [
    ...categories.slice(0, limit - 1),
    {
      name: 'Прочие расходы',
      amount: categories.slice(limit - 1).reduce((sum, category) => sum + category.amount, 0),
    },
  ];
}

function compactAxisValue(value: number): string {
  if (value === 0) return '0';
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value / 1_000_000)} млн`;
  }
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value / 1_000)} тыс`;
}

function niceAxisMax(value: number): number {
  if (value <= 0) return 1_000_000;
  const step = 10 ** Math.floor(Math.log10(value));
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((factor) => factor * step >= value) ?? 10;
  return nice * step;
}

function dayLabel(date: string): string {
  const month = Number(date.slice(5, 7));
  return `${Number(date.slice(8, 10))} ${RUSSIAN_MONTHS_GENITIVE_SHORT[month - 1] ?? ''}`;
}

function incomeChart(
  points: DailyFinanceIncomePoint[],
  left: number,
  top: number,
  width: number,
  height: number,
): string {
  const axisMax = niceAxisMax(Math.max(0, ...points.map((point) => point.amount)));
  const gridLines = [0, 1, 2, 3, 4].map((step) => {
    const value = (axisMax / 4) * step;
    const y = top + height - (height / 4) * step;
    return `<line x1="${left}" y1="${y}" x2="${left + width}" y2="${y}" stroke="${BORDER}" stroke-width="1.5"/>
    <text x="${left - 12}" y="${y + 6}" text-anchor="end" font-size="16" fill="${MUTED}">${escapeXml(compactAxisValue(value))}</text>`;
  }).join('\n    ');

  if (points.length === 0) {
    return `${gridLines}
    <text x="${left + width / 2}" y="${top + height / 2}" text-anchor="middle" font-size="20" fill="${MUTED}">Нет данных за месяц</text>`;
  }

  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const coordinates = points.map((point, index) => ({
    x: points.length > 1 ? left + index * stepX : left + width / 2,
    y: top + height - (Math.max(0, point.amount) / axisMax) * height,
  }));
  const line = coordinates.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  const area = `M${first.x.toFixed(1)},${top + height} L${line.replace(/ /g, ' L')} L${last.x.toFixed(1)},${top + height} Z`;
  const labelIndexes = Array.from(new Set([
    0,
    ...[7, 14, 21].map((day) => day - 1).filter((index) => index < points.length - 3),
    points.length - 1,
  ]));
  const xLabels = labelIndexes.map((index) =>
    `<text x="${coordinates[index].x.toFixed(1)}" y="${top + height + 30}" text-anchor="middle" font-size="16" fill="${MUTED}">${escapeXml(dayLabel(points[index].date))}</text>`,
  ).join('\n    ');

  return `${gridLines}
    ${points.length > 1 ? `<path d="${area}" fill="url(#incomeArea)"/>
    <polyline points="${line}" fill="none" stroke="${BLUE}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="7" fill="#FFFFFF" stroke="${BLUE}" stroke-width="4"/>
    ${xLabels}`;
}

function donut(cx: number, cy: number, radius: number, clubIncome: number, barSales: number): string {
  const total = clubIncome + barSales;
  const circumference = 2 * Math.PI * radius;
  const clubLength = total > 0 ? (clubIncome / total) * circumference : 0;
  const barLength = total > 0 ? circumference - clubLength : 0;

  return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#EEF2F7" stroke-width="30"/>
    ${clubLength > 0 ? `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${BLUE}" stroke-width="30" stroke-dasharray="${clubLength.toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>` : ''}
    ${barLength > 0 ? `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${ORANGE}" stroke-width="30" stroke-dasharray="${barLength.toFixed(2)} ${circumference.toFixed(2)}" stroke-dashoffset="${(-clubLength).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>` : ''}
    <text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="22" font-weight="800" fill="${INK}">${escapeXml(amount(total))}</text>
    <text x="${cx}" y="${cy + 30}" text-anchor="middle" font-size="16" font-weight="700" fill="${MUTED}">UZS · за день</text>`;
}

function kpiTile(
  x: number,
  y: number,
  width: number,
  color: string,
  glyph: string,
  labelLines: string[],
  value: number,
  footer: string,
  change?: number | null,
): string {
  const label = labelLines.map((line, index) =>
    `<text x="${x + 80}" y="${y + 44 + index * 20}" font-size="15" font-weight="800" fill="${color}">${escapeXml(line)}</text>`,
  ).join('');
  const changeText = change === undefined
    ? ''
    : changeBadge(x + 20, y + 170, change, 17);

  return `${card(x, y, width, 226, '#FFFFFF', `${color}55`)}
    ${iconTile(x + 20, y + 22, 48, color, glyph)}
    ${label}
    <text x="${x + 20}" y="${y + 118}" font-size="26" font-weight="800" fill="${color}">${escapeXml(amount(value))}</text>
    <text x="${x + 20}" y="${y + 142}" font-size="16" font-weight="700" fill="${color}">UZS</text>
    ${changeText}
    <text x="${x + 20}" y="${y + (change === undefined ? 176 : 196)}" font-size="15" fill="${MUTED}">${escapeXml(footer)}</text>`;
}

const LOW_STOCK_MAX_ITEMS = 12;
const LOW_STOCK_ROW_HEIGHT = 40;

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
}

function lowStockQuantity(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

/** Two-column list of products that are out of stock or at/below their threshold. */
function lowStockSection(items: LowStockProduct[], y: number): { svg: string; height: number } {
  const visible = items.slice(0, LOW_STOCK_MAX_ITEMS);
  const hidden = items.length - visible.length;
  const rows = Math.ceil(visible.length / 2);
  const height = 96 + rows * LOW_STOCK_ROW_HEIGHT + (hidden > 0 ? 36 : 0) + 16;
  const columnWidth = (PAGE_WIDTH - 56 - 32) / 2;
  const itemsSvg = visible.map((item, index) => {
    const column = index % 2;
    const x = PAGE_X + 28 + column * (columnWidth + 32);
    const rowY = y + 100 + Math.floor(index / 2) * LOW_STOCK_ROW_HEIGHT;
    const out = item.level === 'out';
    const color = out ? RED : ORANGE;
    const value = out
      ? 'нет в наличии'
      : `${lowStockQuantity(item.currentStock)} шт. · порог ${lowStockQuantity(item.threshold)}`;
    return `<circle cx="${x + 7}" cy="${rowY - 7}" r="6" fill="${color}"/>
    <text x="${x + 26}" y="${rowY}" font-size="20" fill="${TEXT}">${escapeXml(truncate(item.name, 28))}</text>
    <text x="${x + columnWidth}" y="${rowY}" text-anchor="end" font-size="20" font-weight="700" fill="${color}">${escapeXml(value)}</text>`;
  }).join('\n    ');
  const more = hidden > 0
    ? `<text x="${PAGE_X + 28}" y="${y + 100 + rows * LOW_STOCK_ROW_HEIGHT}" font-size="18" fill="${MUTED}">и ещё ${hidden} — см. раздел «Товары» в приложении</text>`
    : '';

  return {
    height,
    svg: `${card(PAGE_X, y, PAGE_WIDTH, height, '#FFFBF5', '#FBD5B5')}
    ${iconBadge(PAGE_X + 46, y + 44, 18, ORANGE, GLYPH_ALERT)}
    <text x="${PAGE_X + 76}" y="${y + 51}" font-size="20" font-weight="800" fill="${INK}">ЗАКАНЧИВАЕТСЯ НА СКЛАДЕ · ${items.length}</text>
    <text x="${WIDTH - PAGE_X - 28}" y="${y + 51}" text-anchor="end" font-size="16" fill="${MUTED}">по текущим остаткам</text>
    ${itemsSvg}
    ${more}`,
  };
}

const GLYPH_GIFT = '<rect x="-14" y="-4" width="28" height="18" rx="2"/><line x1="-16" y1="-4" x2="16" y2="-4"/><line x1="0" y1="-4" x2="0" y2="14"/><path d="M0,-4 C-6,-4 -10,-8 -8,-12 C-5,-15 -1,-10 0,-4 C1,-10 5,-15 8,-12 C10,-8 6,-4 0,-4 Z"/>';
const PROMO_MAX_ITEMS = 8;
const PROMO_ROW_HEIGHT = 40;

/** Units handed out free under promotions on the report date. */
function promoGiveawaySection(items: DailyFinancePromoGiveaway[], y: number): { svg: string; height: number } {
  const visible = items.slice(0, PROMO_MAX_ITEMS);
  const hidden = items.length - visible.length;
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  const cost = items.reduce((sum, item) => sum + item.cost, 0);
  const height = 96 + visible.length * PROMO_ROW_HEIGHT + (hidden > 0 ? 36 : 0) + 16;
  const x = PAGE_X + 28;
  const right = WIDTH - PAGE_X - 28;
  const itemsSvg = visible.map((item, index) => {
    const rowY = y + 100 + index * PROMO_ROW_HEIGHT;
    const label = item.promotionName ? `${item.productName} — ${item.promotionName}` : item.productName;
    return `<circle cx="${x + 7}" cy="${rowY - 7}" r="6" fill="${PURPLE}"/>
    <text x="${x + 26}" y="${rowY}" font-size="20" fill="${TEXT}">${escapeXml(truncate(label, 60))}</text>
    <text x="${right - 220}" y="${rowY}" text-anchor="end" font-size="20" font-weight="700" fill="${PURPLE}">${escapeXml(lowStockQuantity(item.quantity))} шт.</text>
    <text x="${right}" y="${rowY}" text-anchor="end" font-size="18" fill="${MUTED}">${escapeXml(money(item.cost))}</text>`;
  }).join('\n    ');
  const more = hidden > 0
    ? `<text x="${x}" y="${y + 100 + visible.length * PROMO_ROW_HEIGHT}" font-size="18" fill="${MUTED}">и ещё ${hidden} — см. «Закрытие склада» в приложении</text>`
    : '';

  return {
    height,
    svg: `${card(PAGE_X, y, PAGE_WIDTH, height, '#F8F5FF', '#DDD2F7')}
    ${iconBadge(PAGE_X + 46, y + 44, 18, PURPLE, GLYPH_GIFT)}
    <text x="${PAGE_X + 76}" y="${y + 51}" font-size="20" font-weight="800" fill="${INK}">БОНУСЫ ПО АКЦИЯМ · ${escapeXml(lowStockQuantity(units))} шт.</text>
    <text x="${right}" y="${y + 51}" text-anchor="end" font-size="16" fill="${MUTED}">себестоимость ${escapeXml(money(cost))} · не считается продажей</text>
    ${itemsSvg}
    ${more}`,
  };
}

const SANKEY_SOURCE_LABELS: Record<IncomeSourceKey, string> = {
  computers: 'Компьютеры',
  playstation: 'PlayStation',
  bar: 'Продажи бара',
  debts: 'Новые долги',
  shortfall: 'Убыток (не покрыт)',
};
const SANKEY_SOURCE_COLORS: Record<IncomeSourceKey, string> = {
  computers: BLUE,
  playstation: PURPLE,
  bar: ORANGE,
  debts: AMBER,
  shortfall: RED,
};
// Same order as the analysis page's category palette.
const SANKEY_CATEGORY_PALETTE = [RED, BLUE, PURPLE, '#0E9FB3', AMBER, '#D6408F', MUTED];
const SANKEY = { nodeWidth: 12, nodePadding: 16, perNode: 44, minHeight: 300, padY: 8, labelGap: 12, hubLabelSpace: 34, fontSize: 17 };

const compactMoneyFormatter = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

function sankeyTargetLabel(key: string): string {
  if (key === BAR_COST_TARGET) return 'Себестоимость бара';
  if (key === PROFIT_TARGET) return 'Прибыль';
  return truncate(RUSSIAN_EXPENSE_CATEGORY_LABELS[key] ?? key.replace(/_/g, ' '), 26);
}

function sankeyTargetColors(targets: AnalysisSankey['targets']): string[] {
  let categoryIndex = 0;
  return targets.map(({ key }) => {
    if (key === BAR_COST_TARGET) return ORANGE;
    if (key === PROFIT_TARGET) return GREEN;
    if (key === OTHER_CATEGORY) return '#94A3B8';
    return SANKEY_CATEGORY_PALETTE[categoryIndex++ % SANKEY_CATEGORY_PALETTE.length];
  });
}

/** Rough width of a label in the bundled Noto Sans; there is no text measurement in the renderer. */
function estimateLabelWidth(text: string): number {
  return text.length * SANKEY.fontSize * 0.55;
}

function sankeyLabel(x: number, y: number, name: string, value: number, anchor: 'start' | 'end' | 'middle'): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" dy="0.35em" text-anchor="${anchor}" font-size="${SANKEY.fontSize}" font-weight="600" fill="${TEXT}">${escapeXml(name)} · <tspan font-weight="800" fill="${INK}">${escapeXml(compactMoneyFormatter.format(Math.round(value)))}</tspan></text>`;
}

/** Label centres at least one line apart, kept inside the chart, as close to their nodes as possible. */
function spreadLabels(centres: number[], chartHeight: number): number[] {
  const gap = SANKEY.fontSize + 6;
  const spread = [...centres];
  for (let index = 1; index < spread.length; index += 1) {
    spread[index] = Math.max(spread[index], spread[index - 1] + gap);
  }
  const overflow = spread[spread.length - 1] - (chartHeight - SANKEY.fontSize / 2);
  if (overflow > 0) {
    spread[spread.length - 1] -= overflow;
    for (let index = spread.length - 2; index >= 0; index -= 1) {
      spread[index] = Math.min(spread[index], spread[index + 1] - gap);
    }
  }
  return spread;
}

/** Filled band between two columns; its top edge runs from (x0, y0) to (x1, y1). */
function sankeyRibbon(x0: number, y0: number, x1: number, y1: number, band: number, color: string): string {
  const thickness = Math.max(1.5, band);
  const mid = (x0 + x1) / 2;
  const f = (value: number) => value.toFixed(1);
  return `<path d="M${f(x0)},${f(y0)} C${f(mid)},${f(y0)} ${f(mid)},${f(y1)} ${f(x1)},${f(y1)} L${f(x1)},${f(y1 + thickness)} C${f(mid)},${f(y1 + thickness)} ${f(mid)},${f(y0 + thickness)} ${f(x0)},${f(y0 + thickness)} Z" fill="${color}" fill-opacity="0.3"/>`;
}

/** Month-to-date money flow: income sources → income → costs, expense categories and profit. */
function sankeySection(sankey: AnalysisSankey | undefined, y: number): { svg: string; height: number } {
  const chartTop = y + 76;
  const heading = (height: number) => `${card(PAGE_X, y, PAGE_WIDTH, height)}
    <text x="${PAGE_X + 28}" y="${y + 50}" font-size="19" font-weight="800" fill="${INK}">КУДА УХОДЯТ ДЕНЬГИ</text>
    <text x="${WIDTH - PAGE_X - 28}" y="${y + 50}" text-anchor="end" font-size="16" fill="${MUTED}">с 1-го числа месяца</text>`;

  if (!sankey || sankey.total <= 0) {
    const height = 76 + 120;
    return {
      height,
      svg: `${heading(height)}
    <text x="${WIDTH / 2}" y="${chartTop + 56}" text-anchor="middle" font-size="20" fill="${MUTED}">Нет данных за месяц</text>`,
    };
  }

  const { nodeWidth, nodePadding, perNode, minHeight, padY, labelGap, hubLabelSpace } = SANKEY;
  const chartHeight = Math.max(minHeight, (Math.max(sankey.sources.length, sankey.targets.length) + 2) * perNode);
  const height = 76 + chartHeight + 24;
  const sourceName = (key: IncomeSourceKey) => SANKEY_SOURCE_LABELS[key];
  const widest = (texts: string[]) => Math.max(0, ...texts.map(estimateLabelWidth));
  const labelText = (name: string, value: number) => `${name} · ${compactMoneyFormatter.format(Math.round(value))}`;
  const leftX = PAGE_X + 28 + widest(sankey.sources.map((node) => labelText(sourceName(node.key), node.amount))) + labelGap;
  const rightX = WIDTH - PAGE_X - 28 - widest(sankey.targets.map((node) => labelText(sankeyTargetLabel(node.key), node.amount))) - labelGap - nodeWidth;
  const hubX = Math.round((leftX + rightX) / 2);
  const layout = layoutSankey(sankey, { height: chartHeight, nodePadding, padY, hubLabelSpace });
  const top = (value: number) => chartTop + value;
  const targetColors = sankeyTargetColors(sankey.targets);
  const sourceLabelY = spreadLabels(layout.sources.map((node) => node.y + node.h / 2), chartHeight);
  const targetLabelY = spreadLabels(layout.targets.map((node) => node.y + node.h / 2), chartHeight);

  const sourceSvg = layout.sources.map((node, index) => {
    const color = SANKEY_SOURCE_COLORS[node.key];
    return `${sankeyRibbon(leftX + nodeWidth, top(node.y + (node.h - node.band) / 2), hubX, top(node.hubY), node.band, color)}
    <rect x="${leftX.toFixed(1)}" y="${top(node.y).toFixed(1)}" width="${nodeWidth}" height="${node.h.toFixed(1)}" rx="3" fill="${color}"/>
    ${sankeyLabel(leftX - labelGap, top(sourceLabelY[index]), sourceName(node.key), node.amount, 'end')}`;
  }).join('\n    ');
  const targetSvg = layout.targets.map((node, index) => {
    const color = targetColors[index];
    return `${sankeyRibbon(hubX + nodeWidth, top(node.hubY), rightX, top(node.y + (node.h - node.band) / 2), node.band, color)}
    <rect x="${rightX.toFixed(1)}" y="${top(node.y).toFixed(1)}" width="${nodeWidth}" height="${node.h.toFixed(1)}" rx="3" fill="${color}"/>
    ${sankeyLabel(rightX + nodeWidth + labelGap, top(targetLabelY[index]), sankeyTargetLabel(node.key), node.amount, 'start')}`;
  }).join('\n    ');

  return {
    height,
    svg: `${heading(height)}
    ${sourceSvg}
    ${targetSvg}
    <rect x="${hubX}" y="${top(layout.hubTop).toFixed(1)}" width="${nodeWidth}" height="${layout.hubHeight.toFixed(1)}" rx="3" fill="${INK}"/>
    ${sankeyLabel(hubX + nodeWidth / 2, top(layout.hubTop) - 20, 'Доход', sankey.income, 'middle')}`,
  };
}

export function buildDailyFinanceReportSvg(input: DailyFinanceReportInput): string {
  const dailyPoints = input.monthDailyGameClubIncome ?? [];
  const clubNetProfit = input.gameClubIncome - input.gameClubExpenses;
  const barNetProfit = input.barSales - input.barCost - input.barExpenses;

  // Header and the month's money flow.
  const headerY = 40;
  const flow = sankeySection(input.monthSankey, 176);

  // Income mix and monthly trend.
  const chartsY = 176 + flow.height + 24;
  const chartsHeight = 400;

  // Club and bar breakdown cards.
  const clubExpenseRows = limitCategories(input.gameClubExpenseCategories, 5);
  const visibleClubExpenseRows = clubExpenseRows.length > 0
    ? clubExpenseRows
    : [{ name: 'Нет расходов', amount: 0 }];
  const barExpenseRows = limitCategories(input.barExpenseCategories, 3);
  const detailY = chartsY + chartsHeight + 24;
  const clubContentHeight = 350 + visibleClubExpenseRows.length * 38;
  const barContentHeight = 190 + 3 * 42 + barExpenseRows.length * 34;
  const detailHeight = Math.max(clubContentHeight, barContentHeight) + 112;
  const detailWidth = (PAGE_WIDTH - 24) / 2;
  const barX = PAGE_X + detailWidth + 24;

  // Key indicators and footer.
  const kpiY = detailY + detailHeight + 24;
  const kpiHeight = 300;
  const promo = input.promoGiveaways?.length
    ? promoGiveawaySection(input.promoGiveaways, kpiY + kpiHeight + 24)
    : null;
  const lowStock = input.lowStockProducts?.length
    ? lowStockSection(input.lowStockProducts, kpiY + kpiHeight + 24 + (promo ? promo.height + 24 : 0))
    : null;
  const footerY = kpiY + kpiHeight + (promo ? 24 + promo.height : 0) + (lowStock ? 24 + lowStock.height : 0) + 20;
  const height = footerY + 60;

  const clubRows = [
    leaderRow(PAGE_X + 28, PAGE_X + detailWidth - 28, detailY + 170, 'Компьютеры', input.computerIncome, BLUE),
    leaderRow(PAGE_X + 28, PAGE_X + detailWidth - 28, detailY + 210, 'PlayStation', input.playstationIncome, BLUE),
    leaderRow(PAGE_X + 28, PAGE_X + detailWidth - 28, detailY + 250, 'Долги', input.debtIncome, BLUE),
  ].join('\n    ');
  const clubExpenseHeadingY = detailY + 310;
  const clubExpenseRowsSvg = visibleClubExpenseRows
    .map((category, index) => leaderRow(
      PAGE_X + 28,
      PAGE_X + detailWidth - 28,
      clubExpenseHeadingY + 40 + index * 38,
      category.name,
      category.amount,
      RED,
      true,
    ))
    .join('\n    ');

  const barRowsSvg: string[] = [
    leaderRow(barX + 28, barX + detailWidth - 28, detailY + 170, 'Себестоимость', input.barCost, SLATE),
    leaderRow(barX + 28, barX + detailWidth - 28, detailY + 212, 'Расходы бара', input.barExpenses, RED),
  ];
  barExpenseRows.forEach((category, index) => {
    barRowsSvg.push(leaderRow(
      barX + 28,
      barX + detailWidth - 28,
      detailY + 246 + index * 34,
      category.name,
      category.amount,
      RED,
      true,
      22,
    ));
  });
  barRowsSvg.push(leaderRow(
    barX + 28,
    barX + detailWidth - 28,
    detailY + 254 + barExpenseRows.length * 34,
    'Закупки склада',
    input.stockPurchases,
    MUTED,
  ));

  const netBoxY = detailY + detailHeight - 112;
  const kpiWidth = (PAGE_WIDTH - 4 * 16) / 5;
  const kpiX = (index: number) => PAGE_X + index * (kpiWidth + 16);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
  <defs>
    <linearGradient id="incomeArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BLUE}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="${BLUE}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${height}" fill="#F4F7FB"/>
  <g font-family="Noto Sans">
    ${iconTile(PAGE_X, headerY, 96, INK, GLYPH_GAMEPAD)}
    <text x="${PAGE_X + 124}" y="${headerY + 50}" font-size="46" font-weight="800" fill="${INK}">ФИНАНСЫ КЛУБА</text>
    <text x="${PAGE_X + 124}" y="${headerY + 88}" font-size="22" fill="${TEXT}">${escapeXml(input.clubName)} · Рабочий день: ${escapeXml(input.businessDateLabel)}</text>

    ${flow.svg}

    ${card(PAGE_X, chartsY, 440, chartsHeight)}
    <text x="${PAGE_X + 28}" y="${chartsY + 50}" font-size="19" font-weight="800" fill="${INK}">ДОХОД ЗА ДЕНЬ ПО НАПРАВЛЕНИЯМ</text>
    ${donut(PAGE_X + 128, chartsY + 226, 92, input.gameClubIncome, input.barSales)}
    <circle cx="${PAGE_X + 262}" cy="${chartsY + 134}" r="7" fill="${BLUE}"/>
    <text x="${PAGE_X + 278}" y="${chartsY + 141}" font-size="18" font-weight="800" fill="${INK}">КЛУБ</text>
    <text x="${PAGE_X + 262}" y="${chartsY + 176}" font-size="22" font-weight="800" fill="${INK}">${escapeXml(money(input.gameClubIncome))}</text>
    <text x="${PAGE_X + 262}" y="${chartsY + 202}" font-size="17" fill="${MUTED}">${escapeXml(percentShare(input.gameClubIncome, input.dailyRevenue))}</text>
    <line x1="${PAGE_X + 262}" y1="${chartsY + 226}" x2="${PAGE_X + 412}" y2="${chartsY + 226}" stroke="${BORDER}" stroke-width="2"/>
    <circle cx="${PAGE_X + 262}" cy="${chartsY + 260}" r="7" fill="${ORANGE}"/>
    <text x="${PAGE_X + 278}" y="${chartsY + 267}" font-size="18" font-weight="800" fill="${INK}">БАР</text>
    <text x="${PAGE_X + 262}" y="${chartsY + 302}" font-size="22" font-weight="800" fill="${INK}">${escapeXml(money(input.barSales))}</text>
    <text x="${PAGE_X + 262}" y="${chartsY + 328}" font-size="17" fill="${MUTED}">${escapeXml(percentShare(input.barSales, input.dailyRevenue))}</text>

    ${card(PAGE_X + 464, chartsY, PAGE_WIDTH - 464, chartsHeight)}
    <text x="${PAGE_X + 492}" y="${chartsY + 50}" font-size="19" font-weight="800" fill="${INK}">ДИНАМИКА ДОХОДА КЛУБА ЗА МЕСЯЦ</text>
    ${incomeChart(dailyPoints, PAGE_X + 580, chartsY + 84, PAGE_WIDTH - 464 - 146, 170)}
    ${card(PAGE_X + 488, chartsY + 306, PAGE_WIDTH - 512, 76, '#F8FAFC')}
    <text x="${PAGE_X + 512}" y="${chartsY + 338}" font-size="17" fill="${TEXT}">Средний доход клуба / день</text>
    ${moneyText(PAGE_X + 512, chartsY + 370, input.averageDailyGameClubIncome, 26, PURPLE)}
    ${changeBadge(WIDTH - PAGE_X - 196, chartsY + 340, input.averageDailyGameClubIncomeChange, 20)}
    <text x="${WIDTH - PAGE_X - 196}" y="${chartsY + 366}" font-size="16" fill="${MUTED}">к прошлому месяцу</text>

    ${card(PAGE_X, detailY, detailWidth, detailHeight, '#FAFCFF', '#C7D7FB')}
    ${iconTile(PAGE_X + 28, detailY + 28, 80, BLUE, GLYPH_GAMEPAD)}
    <text x="${PAGE_X + 130}" y="${detailY + 58}" font-size="22" font-weight="800" fill="${BLUE}">КЛУБ</text>
    ${moneyText(PAGE_X + 130, detailY + 98, input.gameClubIncome, 32, BLUE)}
    <text x="${PAGE_X + 130}" y="${detailY + 126}" font-size="18" fill="${MUTED}">Доход за день</text>
    ${clubRows}
    <line x1="${PAGE_X + 28}" y1="${detailY + 274}" x2="${PAGE_X + detailWidth - 28}" y2="${detailY + 274}" stroke="${BORDER}" stroke-width="2"/>
    <text x="${PAGE_X + 28}" y="${clubExpenseHeadingY}" font-size="20" font-weight="800" fill="${RED}">РАСХОДЫ КЛУБА</text>
    <text x="${PAGE_X + detailWidth - 28}" y="${clubExpenseHeadingY}" text-anchor="end" font-size="20" font-weight="800" fill="${RED}">${escapeXml(money(input.gameClubExpenses))}</text>
    ${clubExpenseRowsSvg}
    ${card(PAGE_X + 20, netBoxY, detailWidth - 40, 88, '#EEF4FF', '#C7D7FB')}
    <text x="${PAGE_X + 44}" y="${netBoxY + 34}" font-size="17" fill="${TEXT}">Чистая прибыль клуба</text>
    ${moneyText(PAGE_X + 44, netBoxY + 70, clubNetProfit, 28, clubNetProfit < 0 ? RED : BLUE)}
    ${iconTile(PAGE_X + detailWidth - 100, netBoxY + 16, 56, BLUE, GLYPH_TREND_UP)}

    ${card(barX, detailY, detailWidth, detailHeight, '#FFFBF7', '#FBD5B5')}
    ${iconTile(barX + 28, detailY + 28, 80, ORANGE, GLYPH_CUP)}
    <text x="${barX + 130}" y="${detailY + 58}" font-size="22" font-weight="800" fill="${ORANGE}">БАР</text>
    ${moneyText(barX + 130, detailY + 98, input.barSales, 32, ORANGE)}
    <text x="${barX + 130}" y="${detailY + 126}" font-size="18" fill="${MUTED}">Продажи за день</text>
    ${barRowsSvg.join('\n    ')}
    ${card(barX + 20, netBoxY, detailWidth - 40, 88, '#FFF3E8', '#FBD5B5')}
    <text x="${barX + 44}" y="${netBoxY + 34}" font-size="17" fill="${TEXT}">Чистая прибыль бара</text>
    ${moneyText(barX + 44, netBoxY + 70, barNetProfit, 28, barNetProfit < 0 ? RED : ORANGE)}
    ${iconTile(barX + detailWidth - 100, netBoxY + 16, 56, ORANGE, GLYPH_BARS)}

    ${card(PAGE_X, kpiY, PAGE_WIDTH, kpiHeight, '#FFFFFF')}
    <text x="${PAGE_X + 28}" y="${kpiY + 44}" font-size="20" font-weight="800" fill="${INK}">КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ</text>
    ${kpiTile(kpiX(0) + 12, kpiY + 62, kpiWidth - 12, GREEN, GLYPH_WALLET, ['ОСТАТОК', 'КЛУБА'], input.gameClubMoneyLeft, 'за месяц')}
    ${kpiTile(kpiX(1) + 6, kpiY + 62, kpiWidth - 12, PURPLE, GLYPH_BARS, ['СРЕДНИЙ', 'ДОХОД / ДЕНЬ'], input.averageDailyGameClubIncome, 'к прошлому месяцу', input.averageDailyGameClubIncomeChange)}
    ${kpiTile(kpiX(2) + 3, kpiY + 62, kpiWidth - 12, ORANGE, GLYPH_CUP, ['ДОХОД БАРА', 'ЗА МЕСЯЦ'], input.barMoneyLeft, 'к прошлому месяцу', input.barMoneyLeftChange)}
    ${kpiTile(kpiX(3), kpiY + 62, kpiWidth - 12, SLATE, GLYPH_BOX, ['СТОИМОСТЬ', 'СКЛАДА'], input.inventoryValue, 'к прошлому месяцу', input.inventoryValueChange)}
    ${kpiTile(kpiX(4) - 6, kpiY + 62, kpiWidth - 6, RED, GLYPH_ALERT, ['АКТИВНЫЕ', 'ДОЛГИ'], input.activeDebts, 'долги клиентов')}
    ${promo?.svg ?? ''}
    ${lowStock?.svg ?? ''}

    <circle cx="${PAGE_X + 18}" cy="${footerY + 18}" r="11" fill="${MUTED}"/>
    <text x="${PAGE_X + 18}" y="${footerY + 24}" text-anchor="middle" font-size="16" font-weight="800" fill="#FFFFFF">i</text>
    <text x="${PAGE_X + 40}" y="${footerY + 24}" font-size="17" fill="${MUTED}">Все суммы указаны в UZS. Дневные показатели — за ${escapeXml(input.businessDateLabel)}, месячные — с 1-го числа.</text>
  </g>
</svg>`;
}

export async function renderDailyFinanceReportPng(input: DailyFinanceReportInput): Promise<Buffer> {
  assertReportFontsAvailable();
  const svg = buildDailyFinanceReportSvg(input);
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}
