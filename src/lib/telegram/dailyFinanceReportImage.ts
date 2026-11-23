import './reportFontConfig';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { formatCurrency } from '../formatters';
import type { LowStockProduct } from '../calculations/stock';
import { BAR_COST_TARGET, OTHER_CATEGORY } from '../calculations/financialAnalysis';
import { BAR_LEFT, GAME_CLUB_LEFT, type DrillSankey } from '../calculations/sankeyDrill';
import { layoutSankey } from '../sankeyLayout';
import { RUSSIAN_EXPENSE_CATEGORY_LABELS } from './expenseCategoryLabels';
import { hasStockAdjustments, runningDailyAverage, type DailyFinanceMonthForecast, type DailyFinanceMonthMoney, stockCorrectionItemLabel, stockWriteOffItemLabel, type DailyFinanceIncomePoint, type DailyFinancePromoGiveaway, type DailyFinanceReportInput, type DailyFinanceStockCorrection, type DailyFinanceStockWriteOff } from './dailyFinanceReport';
import { REPORT_FONT_DIRECTORY, REPORT_FONT_FILES } from './reportFontConfig';

const WIDTH = 1600;
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

/** Roughly how wide changeBadge draws, so text can follow it. */
function changeBadgeWidth(change: number | null | undefined, size: number): number {
  if (change === null || change === undefined || change === 0) return size * 1.6;
  return size * 0.72 + 6 + `${Math.abs(change)}%`.length * size * 0.62;
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
// The same pictures as the app (src/components/sideIcons.ts): the club is a PC, PlayStation the gamepad, the bar a bag.
const GLYPH_MONITOR = '<rect x="-16" y="-14" width="32" height="22" rx="3"/><line x1="0" y1="8" x2="0" y2="15"/><line x1="-8" y1="15" x2="8" y2="15"/>';
const GLYPH_BAG = '<path d="M-12,-6 H12 L10,15 H-10 Z"/><path d="M-6,-6 V-9 A6,6 0 0 1 6,-9 V-6"/>';
const GLYPH_WALLET = '<rect x="-14" y="-10" width="28" height="22" rx="4"/><path d="M4,-3 H14 V6 H4 Z"/><path d="M-10,-10 L6,-16 L8,-10"/>';
const GLYPH_BARS = '<line x1="-10" y1="12" x2="-10" y2="2"/><line x1="0" y1="12" x2="0" y2="-5"/><line x1="10" y1="12" x2="10" y2="-12"/>';
const GLYPH_BOX = '<path d="M0,-15 L14,-7 V9 L0,17 L-14,9 V-7 Z"/><polyline points="-14,-7 0,1 14,-7"/><line x1="0" y1="1" x2="0" y2="17"/>';
const GLYPH_ALERT = '<circle cx="0" cy="0" r="14"/><line x1="0" y1="-7" x2="0" y2="2"/><circle cx="0" cy="8" r="1" fill="#FFFFFF"/>';

const PINK = '#D6408F';
const TEAL = '#0E9FB3';
const GLYPH_TERMINAL = '<rect x="-11" y="-16" width="22" height="32" rx="4"/><rect x="-6" y="-11" width="12" height="8" rx="1"/><line x1="-5" y1="4" x2="-3" y2="4"/><line x1="3" y1="4" x2="5" y2="4"/><line x1="-5" y1="10" x2="-3" y2="10"/><line x1="3" y1="10" x2="5" y2="10"/>';
const GLYPH_CARD = '<rect x="-16" y="-11" width="32" height="22" rx="4"/><line x1="-16" y1="-4" x2="16" y2="-4"/><line x1="-10" y1="5" x2="-2" y2="5"/>';
const GLYPH_SAFE = '<rect x="-15" y="-14" width="30" height="28" rx="4"/><circle cx="0" cy="0" r="6"/><line x1="0" y1="-6" x2="0" y2="-3"/><line x1="-10" y1="14" x2="-10" y2="17"/><line x1="10" y1="14" x2="10" y2="17"/>';
const GLYPH_USER = '<circle cx="0" cy="-7" r="7"/><path d="M-13,15 C-13,5 -7,1 0,1 C7,1 13,5 13,15"/>';
const GLYPH_PEOPLE = '<circle cx="-6" cy="-6" r="6"/><path d="M-17,14 C-17,5 -12,1 -6,1 C0,1 5,5 5,14"/><circle cx="9" cy="-8" r="5"/><path d="M8,0 C14,0 18,4 18,12"/>';

function compactMoney(value: number): string {
  return compactMoneyFormatter.format(Math.round(value));
}

/** One figure of the month's money: icon, label, the amount and a short line under it. */
function monthMoneyTile(
  x: number,
  y: number,
  width: number,
  color: string,
  fill: string,
  glyph: string,
  label: string,
  value: number,
  footer: string,
): string {
  return `${card(x, y, width, MONTH_MONEY_TILE_HEIGHT, fill, `${color}55`)}
    ${iconTile(x + 18, y + 18, 44, color, glyph)}
    <text x="${x + 74}" y="${y + 47}" font-size="16" font-weight="800" fill="${color}">${escapeXml(label)}</text>
    ${moneyText(x + 20, y + 104, value, 30, value < 0 ? RED : color)}
    <text x="${x + 20}" y="${y + 134}" font-size="15" fill="${MUTED}">${escapeXml(footer)}</text>`;
}

const MONTH_MONEY_TILE_HEIGHT = 152;

/**
 * Where the month's money is (Game Club money per payment method) and what was
 * deliberately moved out of the businesses (investments, the owner reserve,
 * owner withdrawals, salaries).
 */
function monthMoneySection(value: DailyFinanceMonthMoney, y: number): { svg: string; height: number } {
  const innerX = PAGE_X + 28;
  const innerWidth = PAGE_WIDTH - 56;
  const gap = 16;
  const methods = [
    { key: 'cash', label: 'НАЛИЧНЫЕ', color: GREEN, fill: '#F0FAF3', glyph: GLYPH_WALLET, amount: value.byMethod.cash },
    { key: 'terminal', label: 'ТЕРМИНАЛ', color: BLUE, fill: '#EEF4FF', glyph: GLYPH_TERMINAL, amount: value.byMethod.terminal },
    { key: 'card', label: 'КАРТА', color: PINK, fill: '#FDF0F7', glyph: GLYPH_CARD, amount: value.byMethod.card },
    { key: 'playstation', label: 'PLAYSTATION', color: PURPLE, fill: '#F7F3FF', glyph: GLYPH_GAMEPAD, amount: value.byMethod.playstation },
  ].filter((method) => method.key === 'cash' || method.amount !== 0);
  const total = methods.reduce((sum, method) => sum + method.amount, 0);
  const positiveTotal = methods.reduce((sum, method) => sum + Math.max(0, method.amount), 0);

  // Share bar: each method's part of the money the club holds.
  const barY = y + 108;
  let barX = innerX;
  const segments = positiveTotal > 0
    ? methods.filter((method) => method.amount > 0).map((method) => {
      const width = (method.amount / positiveTotal) * innerWidth;
      const segment = `<rect x="${barX}" y="${barY}" width="${Math.max(0, width - 3)}" height="14" fill="${method.color}"/>`;
      barX += width;
      return segment;
    }).join('')
    : '';
  const share = (amount: number) => (positiveTotal > 0 && amount > 0
    ? `${Math.round((amount / positiveTotal) * 100)}% денег клуба`
    : 'за месяц');

  const methodWidth = (innerWidth - gap * (methods.length - 1)) / methods.length;
  const methodY = y + 144;
  const methodTiles = methods.map((method, index) => monthMoneyTile(
    innerX + index * (methodWidth + gap), methodY, methodWidth, method.color, method.fill, method.glyph,
    method.label, method.amount, share(method.amount),
  )).join('\n    ');

  const flowHeadingY = methodY + MONTH_MONEY_TILE_HEIGHT + 48;
  const flowY = flowHeadingY + 20;
  const invested = value.invested.gameClub + value.invested.bar;
  const flows = [
    { label: 'ИНВЕСТИРОВАНО', color: AMBER, fill: '#FFF8EB', glyph: GLYPH_TREND_UP, amount: invested,
      footer: `клуб ${compactMoney(value.invested.gameClub)} · бар ${compactMoney(value.invested.bar)}` },
    { label: 'В РЕЗЕРВ', color: TEAL, fill: '#EEFAFC', glyph: GLYPH_SAFE, amount: value.reserve.net,
      footer: `внесено ${compactMoney(value.reserve.deposited)} · возврат ${compactMoney(value.reserve.returned)}` },
    ...(value.withdrawn ? [{
      label: 'ВЫВЕДЕНО ВЛАДЕЛЬЦАМИ', color: SLATE, fill: '#F8FAFC', glyph: GLYPH_USER,
      amount: value.withdrawn.gameClub + value.withdrawn.bar,
      footer: `клуб ${compactMoney(value.withdrawn.gameClub)} · бар ${compactMoney(value.withdrawn.bar)}`,
    }] : []),
    { label: 'ЗАРПЛАТЫ', color: BLUE, fill: '#F5F8FF', glyph: GLYPH_PEOPLE, amount: value.salaries, footer: 'выплачено за месяц' },
  ];
  const flowWidth = (innerWidth - gap * (flows.length - 1)) / flows.length;
  const flowTiles = flows.map((flow, index) => monthMoneyTile(
    innerX + index * (flowWidth + gap), flowY, flowWidth, flow.color, flow.fill, flow.glyph,
    flow.label, flow.amount, flow.footer,
  )).join('\n    ');
  const height = flowY + MONTH_MONEY_TILE_HEIGHT + 28 - y;

  return {
    height,
    svg: `${card(PAGE_X, y, PAGE_WIDTH, height)}
    <text x="${innerX}" y="${y + 44}" font-size="19" font-weight="800" fill="${INK}">ДЕНЬГИ ЗА МЕСЯЦ</text>
    <text x="${PAGE_X + PAGE_WIDTH - 28}" y="${y + 44}" text-anchor="end" font-size="16" fill="${MUTED}">с 1-го числа</text>
    <text x="${innerX}" y="${y + 90}" font-size="16" font-weight="800" fill="${MUTED}">ГДЕ ДЕНЬГИ КЛУБА</text>
    <text x="${PAGE_X + PAGE_WIDTH - 28}" y="${y + 90}" text-anchor="end" font-size="18" font-weight="800" fill="${total < 0 ? RED : INK}">Всего: ${escapeXml(money(total))}</text>
    <rect x="${innerX}" y="${barY}" width="${innerWidth}" height="14" rx="7" fill="${BORDER}"/>
    <clipPath id="methodShare"><rect x="${innerX}" y="${barY}" width="${innerWidth}" height="14" rx="7"/></clipPath>
    <g clip-path="url(#methodShare)">${segments}</g>
    ${methodTiles}
    <text x="${innerX}" y="${flowHeadingY}" font-size="16" font-weight="800" fill="${MUTED}">КУДА НАПРАВЛЕНЫ ДЕНЬГИ</text>
    ${flowTiles}`,
  };
}

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

/**
 * PlayStation money per day as bars, with the running daily average as a line
 * on the same axis, so a rising line means each new day lifts the average.
 */
function playstationChart(
  points: DailyFinanceIncomePoint[],
  left: number,
  top: number,
  width: number,
  height: number,
): string {
  const averages = runningDailyAverage(points);
  const axisMax = niceAxisMax(Math.max(0, ...points.map((point) => point.amount), ...averages.map((point) => point.amount)));
  const gridLines = [0, 1, 2, 3, 4].map((step) => {
    const value = (axisMax / 4) * step;
    const y = top + height - (height / 4) * step;
    return `<line x1="${left}" y1="${y}" x2="${left + width}" y2="${y}" stroke="${BORDER}" stroke-width="1.5"/>
    <text x="${left - 12}" y="${y + 6}" text-anchor="end" font-size="16" fill="${MUTED}">${escapeXml(compactAxisValue(value))}</text>`;
  }).join('\n    ');

  if (points.length === 0 || points.every((point) => point.amount === 0)) {
    return `${gridLines}
    <text x="${left + width / 2}" y="${top + height / 2}" text-anchor="middle" font-size="20" fill="${MUTED}">Нет продаж PlayStation за месяц</text>`;
  }

  const slot = width / points.length;
  const barWidth = Math.max(4, Math.min(28, slot * 0.6));
  const centre = (index: number) => left + slot * index + slot / 2;
  const yOf = (value: number) => top + height - (Math.max(0, value) / axisMax) * height;
  const bars = points.map((point, index) => {
    if (point.amount <= 0) return '';
    const y = yOf(point.amount);
    return `<rect x="${(centre(index) - barWidth / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(top + height - y).toFixed(1)}" rx="3" fill="${PURPLE}" fill-opacity="0.8"/>`;
  }).join('\n    ');
  const line = averages.map((point, index) => `${centre(index).toFixed(1)},${yOf(point.amount).toFixed(1)}`).join(' ');
  const last = averages[averages.length - 1];
  const labelIndexes = Array.from(new Set([
    0,
    ...[7, 14, 21].map((day) => day - 1).filter((index) => index < points.length - 3),
    points.length - 1,
  ]));
  const xLabels = labelIndexes.map((index) =>
    `<text x="${centre(index).toFixed(1)}" y="${top + height + 30}" text-anchor="middle" font-size="16" fill="${MUTED}">${escapeXml(dayLabel(points[index].date))}</text>`,
  ).join('\n    ');

  return `${gridLines}
    ${bars}
    ${points.length > 1 ? `<polyline points="${line}" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    <circle cx="${centre(averages.length - 1).toFixed(1)}" cy="${yOf(last.amount).toFixed(1)}" r="7" fill="#FFFFFF" stroke="${INK}" stroke-width="4"/>
    ${xLabels}`;
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

const GLYPH_TRASH = '<line x1="-14" y1="-9" x2="14" y2="-9"/><path d="M-5,-9 V-14 H5 V-9"/><path d="M-11,-9 L-9,15 H9 L11,-9"/><line x1="-3" y1="-3" x2="-3" y2="9"/><line x1="3" y1="-3" x2="3" y2="9"/>';

/** Most rows each list of the write-offs image shows before "и ещё N". */
const ADJUSTMENT_MAX_ITEMS = 30;

/** Bar units written off (shortage/expired) on the report date; their cost is in bar cost. */
function stockWriteOffSection(items: DailyFinanceStockWriteOff[], y: number): { svg: string; height: number } {
  const visible = items.slice(0, ADJUSTMENT_MAX_ITEMS);
  const hidden = items.length - visible.length;
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  const cost = items.reduce((sum, item) => sum + item.cost, 0);
  const height = 96 + visible.length * PROMO_ROW_HEIGHT + (hidden > 0 ? 36 : 0) + 16;
  const x = PAGE_X + 28;
  const right = WIDTH - PAGE_X - 28;
  const itemsSvg = visible.map((item, index) => {
    const rowY = y + 100 + index * PROMO_ROW_HEIGHT;
    return `<circle cx="${x + 7}" cy="${rowY - 7}" r="6" fill="${RED}"/>
    <text x="${x + 26}" y="${rowY}" font-size="20" fill="${TEXT}">${escapeXml(truncate(stockWriteOffItemLabel(item), 60))}</text>
    <text x="${right - 220}" y="${rowY}" text-anchor="end" font-size="20" font-weight="700" fill="${RED}">${escapeXml(lowStockQuantity(item.quantity))} шт.</text>
    <text x="${right}" y="${rowY}" text-anchor="end" font-size="18" fill="${MUTED}">${escapeXml(money(item.cost))}</text>`;
  }).join('\n    ');
  const more = hidden > 0
    ? `<text x="${x}" y="${y + 100 + visible.length * PROMO_ROW_HEIGHT}" font-size="18" fill="${MUTED}">и ещё ${hidden} — см. «Отчёты → Списания» в приложении</text>`
    : '';

  return {
    height,
    svg: `${card(PAGE_X, y, PAGE_WIDTH, height, '#FEF2F2', '#FBD5D5')}
    ${iconBadge(PAGE_X + 46, y + 44, 18, RED, GLYPH_TRASH)}
    <text x="${PAGE_X + 76}" y="${y + 51}" font-size="20" font-weight="800" fill="${INK}">СПИСАНИЯ БАРА · ${escapeXml(lowStockQuantity(units))} шт.</text>
    <text x="${right}" y="${y + 51}" text-anchor="end" font-size="16" fill="${MUTED}">убыток ${escapeXml(money(cost))} · вычтен из прибыли бара</text>
    ${itemsSvg}
    ${more}`,
  };
}

const GLYPH_PLUS = '<circle cx="0" cy="0" r="14"/><line x1="0" y1="-7" x2="0" y2="7"/><line x1="-7" y1="0" x2="7" y2="0"/>';

/** Units counted above the expected stock on the report date; bar profit is unchanged. */
function stockCorrectionSection(items: DailyFinanceStockCorrection[], y: number): { svg: string; height: number } {
  const visible = items.slice(0, ADJUSTMENT_MAX_ITEMS);
  const hidden = items.length - visible.length;
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  const value = items.reduce((sum, item) => sum + item.value, 0);
  const height = 96 + visible.length * PROMO_ROW_HEIGHT + (hidden > 0 ? 36 : 0) + 16;
  const x = PAGE_X + 28;
  const right = WIDTH - PAGE_X - 28;
  const itemsSvg = visible.map((item, index) => {
    const rowY = y + 100 + index * PROMO_ROW_HEIGHT;
    return `<circle cx="${x + 7}" cy="${rowY - 7}" r="6" fill="${GREEN}"/>
    <text x="${x + 26}" y="${rowY}" font-size="20" fill="${TEXT}">${escapeXml(truncate(stockCorrectionItemLabel(item), 60))}</text>
    <text x="${right - 220}" y="${rowY}" text-anchor="end" font-size="20" font-weight="700" fill="${GREEN}">+${escapeXml(lowStockQuantity(item.quantity))} шт.</text>
    <text x="${right}" y="${rowY}" text-anchor="end" font-size="18" fill="${MUTED}">${escapeXml(money(item.value))}</text>`;
  }).join('\n    ');
  const more = hidden > 0
    ? `<text x="${x}" y="${y + 100 + visible.length * PROMO_ROW_HEIGHT}" font-size="18" fill="${MUTED}">и ещё ${hidden} — см. «Списания» в приложении</text>`
    : '';

  return {
    height,
    svg: `${card(PAGE_X, y, PAGE_WIDTH, height, '#F0FDF4', '#BBE5C8')}
    ${iconBadge(PAGE_X + 46, y + 44, 18, GREEN, GLYPH_PLUS)}
    <text x="${PAGE_X + 76}" y="${y + 51}" font-size="20" font-weight="800" fill="${INK}">КОРРЕКТИРОВКИ · +${escapeXml(lowStockQuantity(units))} шт.</text>
    <text x="${right}" y="${y + 51}" text-anchor="end" font-size="16" fill="${MUTED}">больше ожидаемого · по себестоимости ${escapeXml(money(value))} · прибыль не меняется</text>
    ${itemsSvg}
    ${more}`,
  };
}

/** One summary tile of the write-offs image: units and their value at cost. */
function adjustmentTile(x: number, y: number, width: number, label: string, color: string, fill: string, border: string, glyph: string, units: string, value: number): string {
  return `${card(x, y, width, 150, fill, border)}
    ${iconTile(x + 24, y + 24, 56, color, glyph)}
    <text x="${x + 100}" y="${y + 50}" font-size="18" font-weight="800" fill="${color}">${escapeXml(label)}</text>
    <text x="${x + 100}" y="${y + 88}" font-size="30" font-weight="800" fill="${INK}">${escapeXml(units)}</text>
    <text x="${x + 100}" y="${y + 124}" font-size="18" fill="${MUTED}">${escapeXml(money(value))}</text>`;
}

/**
 * The day's bar write-offs and corrections on an image of their own, sent
 * after the daily report only when there were any.
 */
export function buildStockAdjustmentsReportSvg(input: DailyFinanceReportInput): string {
  const writeOffs = input.stockWriteOffs ?? [];
  const corrections = input.stockCorrections ?? [];
  const totals = (kind: DailyFinanceStockWriteOff['kind']) => writeOffs
    .filter((item) => item.kind === kind)
    .reduce((sum, item) => ({ quantity: sum.quantity + item.quantity, cost: sum.cost + item.cost }), { quantity: 0, cost: 0 });
  const shortage = totals('shortage');
  const expired = totals('expired');
  const correctionUnits = corrections.reduce((sum, item) => sum + item.quantity, 0);
  const correctionValue = corrections.reduce((sum, item) => sum + item.value, 0);
  const loss = shortage.cost + expired.cost;

  const headerY = 40;
  const tilesY = 176;
  const tileWidth = (PAGE_WIDTH - 2 * 24) / 3;
  const tileX = (index: number) => PAGE_X + index * (tileWidth + 24);
  let y = tilesY + 150 + 24;
  const writeOffList = writeOffs.length ? stockWriteOffSection(writeOffs, y) : null;
  if (writeOffList) y += writeOffList.height + 24;
  const correctionList = corrections.length ? stockCorrectionSection(corrections, y) : null;
  if (correctionList) y += correctionList.height + 24;
  const footerY = y;
  const height = footerY + 60;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
  <rect width="${WIDTH}" height="${height}" fill="#F4F7FB"/>
  <g font-family="Noto Sans">
    ${iconTile(PAGE_X, headerY, 96, RED, GLYPH_TRASH)}
    <text x="${PAGE_X + 124}" y="${headerY + 50}" font-size="46" font-weight="800" fill="${INK}">СПИСАНИЯ И КОРРЕКТИРОВКИ БАРА</text>
    <text x="${PAGE_X + 124}" y="${headerY + 88}" font-size="22" fill="${TEXT}">${escapeXml(input.clubName)} · Рабочий день: ${escapeXml(input.businessDateLabel)}</text>
    <text x="${WIDTH - PAGE_X}" y="${headerY + 50}" text-anchor="end" font-size="18" fill="${MUTED}">Убыток бара</text>
    ${moneyText(WIDTH - PAGE_X, headerY + 88, loss, 30, loss > 0 ? RED : MUTED, 'end')}

    ${adjustmentTile(tileX(0), tilesY, tileWidth, 'НЕДОСТАЧА', RED, '#FEF2F2', '#FBD5D5', GLYPH_ALERT, `${lowStockQuantity(shortage.quantity)} шт.`, shortage.cost)}
    ${adjustmentTile(tileX(1), tilesY, tileWidth, 'ПРОСРОЧКА', AMBER, '#FFFBEB', '#FDE3A7', GLYPH_TRASH, `${lowStockQuantity(expired.quantity)} шт.`, expired.cost)}
    ${adjustmentTile(tileX(2), tilesY, tileWidth, 'КОРРЕКТИРОВКА', GREEN, '#F0FDF4', '#BBE5C8', GLYPH_PLUS, `+${lowStockQuantity(correctionUnits)} шт.`, correctionValue)}

    ${writeOffList?.svg ?? ''}
    ${correctionList?.svg ?? ''}

    <circle cx="${PAGE_X + 18}" cy="${footerY + 18}" r="11" fill="${MUTED}"/>
    <text x="${PAGE_X + 18}" y="${footerY + 24}" text-anchor="middle" font-size="16" font-weight="800" fill="#FFFFFF">i</text>
    <text x="${PAGE_X + 40}" y="${footerY + 24}" font-size="17" fill="${MUTED}">Списания вычтены из прибыли бара по себестоимости; корректировки добавлены к остатку и прибыль не меняют.</text>
  </g>
</svg>`;
}

const SANKEY_SOURCE_LABELS: Record<string, string> = {
  computers: 'Компьютеры',
  playstation: 'PlayStation',
  bar: 'Продажи бара',
  debts: 'Новые долги',
  shortfall: 'Убыток (не покрыт)',
};
const SANKEY_SOURCE_COLORS: Record<string, string> = {
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
  if (key === GAME_CLUB_LEFT || key === BAR_LEFT) return 'Остаток';
  return truncate(RUSSIAN_EXPENSE_CATEGORY_LABELS[key] ?? key.replace(/_/g, ' '), 26);
}

function sankeyTargetColors(targets: DrillSankey['targets']): string[] {
  let categoryIndex = 0;
  return targets.map(({ key }) => {
    if (key === BAR_COST_TARGET) return ORANGE;
    if (key === GAME_CLUB_LEFT || key === BAR_LEFT) return GREEN;
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

/**
 * Month-to-date flow of one business's money (club or bar, never pooled):
 * its income sources → hub → its costs, expense categories and what is left.
 */
function sankeySection(
  sankey: DrillSankey | undefined,
  title: string,
  hubLabel: string,
  y: number,
): { svg: string; height: number } {
  const chartTop = y + 76;
  const heading = (height: number) => `${card(PAGE_X, y, PAGE_WIDTH, height)}
    <text x="${PAGE_X + 28}" y="${y + 50}" font-size="19" font-weight="800" fill="${INK}">${escapeXml(title)}</text>
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
  const sourceName = (key: string) => SANKEY_SOURCE_LABELS[key] ?? key;
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
    const color = SANKEY_SOURCE_COLORS[node.key] ?? MUTED;
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
    ${sankeyLabel(hubX + nodeWidth / 2, top(layout.hubTop) - 20, hubLabel, sankey.income, 'middle')}`,
  };
}

function svgDocument(height: number, body: string): string {
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
    ${body}
  </g>
</svg>`;
}

const HEADER_Y = 40;
/** Where the first section starts under the header. */
const CONTENT_Y = 176;

function reportHeader(title: string, subtitle: string, glyph: string): string {
  return `${iconTile(PAGE_X, HEADER_Y, 96, INK, glyph)}
    <text x="${PAGE_X + 124}" y="${HEADER_Y + 50}" font-size="46" font-weight="800" fill="${INK}">${escapeXml(title)}</text>
    <text x="${PAGE_X + 124}" y="${HEADER_Y + 88}" font-size="22" fill="${TEXT}">${escapeXml(subtitle)}</text>`;
}

function reportFooter(y: number, text: string): string {
  return `<circle cx="${PAGE_X + 18}" cy="${y + 18}" r="11" fill="${MUTED}"/>
    <text x="${PAGE_X + 18}" y="${y + 24}" text-anchor="middle" font-size="16" font-weight="800" fill="#FFFFFF">i</text>
    <text x="${PAGE_X + 40}" y="${y + 24}" font-size="17" fill="${MUTED}">${escapeXml(text)}</text>`;
}

/** The day: each business's money today, its breakdown, giveaways and what is running out. */
export function buildDailyFinanceReportSvg(input: DailyFinanceReportInput): string {
  const clubNetProfit = input.gameClubIncome - input.gameClubExpenses;
  const barNetProfit = input.barSales - input.barCost - input.barExpenses;

  // Today's money: club, PlayStation and bar side by side, each with its average per day.
  const todayY = CONTENT_Y;
  const todayHeight = 236;
  const tileGap = 20;
  const tileWidth = (PAGE_WIDTH - 56 - tileGap * 2) / 3;
  const tileX = (index: number) => PAGE_X + 28 + index * (tileWidth + tileGap);

  // Club and bar breakdown cards.
  const clubExpenseRows = limitCategories(input.gameClubExpenseCategories, 5);
  const visibleClubExpenseRows = clubExpenseRows.length > 0
    ? clubExpenseRows
    : [{ name: 'Нет расходов', amount: 0 }];
  const barExpenseRows = limitCategories(input.barExpenseCategories, 3);
  const detailY = todayY + todayHeight + 24;
  const clubContentHeight = 350 + visibleClubExpenseRows.length * 38;
  const barContentHeight = 190 + 3 * 42 + barExpenseRows.length * 34;
  const detailHeight = Math.max(clubContentHeight, barContentHeight) + 112;
  const detailWidth = (PAGE_WIDTH - 24) / 2;
  const barX = PAGE_X + detailWidth + 24;

  const promo = input.promoGiveaways?.length
    ? promoGiveawaySection(input.promoGiveaways, detailY + detailHeight + 24)
    : null;
  // Write-offs and corrections have an image of their own (buildStockAdjustmentsReportSvg).
  const lowStockY = detailY + detailHeight + 24 + (promo ? promo.height + 24 : 0);
  const lowStock = input.lowStockProducts?.length
    ? lowStockSection(input.lowStockProducts, lowStockY)
    : null;
  const footerY = lowStockY + (lowStock ? lowStock.height + 24 : 0) - 4;
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

  return svgDocument(height, `${reportHeader('ФИНАНСЫ ДНЯ', `${input.clubName} · Рабочий день: ${input.businessDateLabel}`, GLYPH_MONITOR)}

    ${card(PAGE_X, todayY, PAGE_WIDTH, todayHeight)}
    <text x="${PAGE_X + 28}" y="${todayY + 50}" font-size="19" font-weight="800" fill="${INK}">ДОХОД ЗА ДЕНЬ</text>
    ${incomeTile(tileX(0), todayY + 72, 'КЛУБ', BLUE, '#EEF4FF', '#C7D7FB', GLYPH_MONITOR, input.gameClubIncome, input.averageDailyGameClubIncome, input.averageDailyGameClubIncomeChange, tileWidth)}
    ${incomeTile(tileX(1), todayY + 72, 'PLAYSTATION', PURPLE, '#F7F3FF', '#DDD0FB', GLYPH_GAMEPAD, input.playstationIncome, input.averageDailyPlaystationIncome, input.averageDailyPlaystationIncomeChange, tileWidth)}
    ${incomeTile(tileX(2), todayY + 72, 'БАР', ORANGE, '#FFF3E8', '#FBD5B5', GLYPH_BAG, input.barSales, input.averageDailyBarSales, input.averageDailyBarSalesChange, tileWidth)}

    ${card(PAGE_X, detailY, detailWidth, detailHeight, '#FAFCFF', '#C7D7FB')}
    ${iconTile(PAGE_X + 28, detailY + 28, 80, BLUE, GLYPH_MONITOR)}
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
    ${iconTile(barX + 28, detailY + 28, 80, ORANGE, GLYPH_BAG)}
    <text x="${barX + 130}" y="${detailY + 58}" font-size="22" font-weight="800" fill="${ORANGE}">БАР</text>
    ${moneyText(barX + 130, detailY + 98, input.barSales, 32, ORANGE)}
    <text x="${barX + 130}" y="${detailY + 126}" font-size="18" fill="${MUTED}">Продажи за день</text>
    ${barRowsSvg.join('\n    ')}
    ${card(barX + 20, netBoxY, detailWidth - 40, 88, '#FFF3E8', '#FBD5B5')}
    <text x="${barX + 44}" y="${netBoxY + 34}" font-size="17" fill="${TEXT}">Чистая прибыль бара</text>
    ${moneyText(barX + 44, netBoxY + 70, barNetProfit, 28, barNetProfit < 0 ? RED : ORANGE)}
    ${iconTile(barX + detailWidth - 100, netBoxY + 16, 56, ORANGE, GLYPH_BARS)}

    ${promo?.svg ?? ''}
    ${lowStock?.svg ?? ''}

    ${reportFooter(footerY, `Все суммы указаны в UZS, за ${input.businessDateLabel}. Итоги месяца и прогноз — на следующих изображениях.`)}`);
}

const FORECAST_TILE_HEIGHT = 176;

/** One month-end projection: the figure, where the month is now and last month's total. */
function forecastTile(
  x: number,
  y: number,
  width: number,
  color: string,
  fill: string,
  glyph: string,
  label: string,
  projected: number | null,
  toDate: number,
  lastMonth: number,
): string {
  const change = projected === null ? null : percentChangeOf(projected, lastMonth);
  return `${card(x, y, width, FORECAST_TILE_HEIGHT, fill, `${color}55`)}
    ${iconTile(x + 18, y + 18, 44, color, glyph)}
    <text x="${x + 74}" y="${y + 47}" font-size="16" font-weight="800" fill="${color}">${escapeXml(label)}</text>
    ${projected === null
    ? `<text x="${x + 20}" y="${y + 104}" font-size="26" font-weight="800" fill="${MUTED}">нет данных</text>`
    : moneyText(x + 20, y + 104, projected, 30, projected < 0 ? RED : color)}
    <text x="${x + 20}" y="${y + 134}" font-size="15" fill="${MUTED}">${escapeXml(`сейчас ${compactMoney(toDate)} · прошлый ${compactMoney(lastMonth)}`)}</text>
    ${changeBadge(x + 20, y + 160, change, 16)}
    <text x="${x + 20 + changeBadgeWidth(change, 16) + 14}" y="${y + 160}" font-size="15" fill="${MUTED}">к прошлому месяцу</text>`;
}

function percentChangeOf(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

/** Where the month ends if the rest of it keeps this month's daily pace. */
function forecastSection(forecast: DailyFinanceMonthForecast, y: number): { svg: string; height: number } {
  const innerX = PAGE_X + 28;
  const gap = 16;
  const tiles = [
    { label: 'ДОХОД КЛУБА', color: BLUE, fill: '#EEF4FF', glyph: GLYPH_MONITOR, side: forecast.gameClub, profit: false },
    { label: 'ПРИБЫЛЬ КЛУБА', color: GREEN, fill: '#F0FAF3', glyph: GLYPH_TREND_UP, side: forecast.gameClub, profit: true },
    { label: 'PLAYSTATION', color: PURPLE, fill: '#F7F3FF', glyph: GLYPH_GAMEPAD, side: forecast.playstation, profit: false },
    { label: 'ПРОДАЖИ БАРА', color: ORANGE, fill: '#FFF3E8', glyph: GLYPH_BAG, side: forecast.bar, profit: false },
  ];
  const width = (PAGE_WIDTH - 56 - gap * (tiles.length - 1)) / tiles.length;
  const tilesSvg = tiles.map((tile, index) => forecastTile(
    innerX + index * (width + gap), y + 72, width, tile.color, tile.fill, tile.glyph, tile.label,
    tile.profit ? tile.side.projectedProfit : tile.side.projectedIncome,
    tile.profit ? tile.side.profitToDate : tile.side.incomeToDate,
    tile.profit ? tile.side.lastMonthProfit : tile.side.lastMonthIncome,
  )).join('\n    ');
  const height = 72 + FORECAST_TILE_HEIGHT + 28;
  return {
    height,
    svg: `${card(PAGE_X, y, PAGE_WIDTH, height)}
    <text x="${innerX}" y="${y + 44}" font-size="19" font-weight="800" fill="${INK}">ПРОГНОЗ НА КОНЕЦ МЕСЯЦА</text>
    <text x="${PAGE_X + PAGE_WIDTH - 28}" y="${y + 44}" text-anchor="end" font-size="16" fill="${MUTED}">${escapeXml(`при текущем темпе · осталось ${forecast.daysLeft} дн.`)}</text>
    ${tilesSvg}`,
  };
}

const FORECAST_CHART_HEIGHT = 300;
type ForecastChartSide = 'gameClub' | 'bar' | 'playstation';

/**
 * Money in, added up day by day: this month so far (solid), where it goes at
 * this pace (dashed) and last month (grey), on one axis.
 */
function forecastChart(
  days: DailyFinanceMonthForecast['days'],
  side: ForecastChartSide,
  color: string,
  left: number,
  top: number,
  width: number,
  height: number,
): string {
  const actual = days.map((row) => row[`${side}Actual`]);
  const projected = days.map((row) => row[`${side}Projected`]);
  const lastMonth = days.map((row) => row[`${side}LastMonth`]);
  const values = [...actual, ...projected, ...lastMonth].filter((value): value is number => value !== null);
  const axisMax = niceAxisMax(Math.max(0, ...values));
  const grid = [0, 1, 2, 3, 4].map((step) => {
    const y = top + height - (height / 4) * step;
    return `<line x1="${left}" y1="${y}" x2="${left + width}" y2="${y}" stroke="${BORDER}" stroke-width="1.5"/>
    <text x="${left - 12}" y="${y + 6}" text-anchor="end" font-size="16" fill="${MUTED}">${escapeXml(compactAxisValue((axisMax / 4) * step))}</text>`;
  }).join('\n    ');
  if (values.length === 0) {
    return `${grid}
    <text x="${left + width / 2}" y="${top + height / 2}" text-anchor="middle" font-size="20" fill="${MUTED}">Нет данных за месяц</text>`;
  }
  const stepX = days.length > 1 ? width / (days.length - 1) : 0;
  const point = (index: number, value: number) => `${(left + index * stepX).toFixed(1)},${(top + height - (Math.max(0, value) / axisMax) * height).toFixed(1)}`;
  const polyline = (series: Array<number | null>, style: string) => {
    const points = series.flatMap((value, index) => (value === null ? [] : [point(index, value)]));
    return points.length > 1 ? `<polyline points="${points.join(' ')}" fill="none" ${style} stroke-linejoin="round" stroke-linecap="round"/>` : '';
  };
  const lastActual = actual.reduce<number>((found, value, index) => (value === null ? found : index), -1);
  const lastProjected = projected.length - 1;
  const endValue = projected[lastProjected];
  const marker = (index: number, value: number | null, fill: string) => (value === null || index < 0 ? '' : (() => {
    const [cx, cy] = point(index, value).split(',');
    return `<circle cx="${cx}" cy="${cy}" r="7" fill="${fill}" stroke="${color}" stroke-width="4"/>`;
  })());
  const labelDays = Array.from(new Set([1, 7, 14, 21, days.length].filter((day) => day <= days.length)));
  const xLabels = labelDays.map((day) =>
    `<text x="${(left + (day - 1) * stepX).toFixed(1)}" y="${top + height + 30}" text-anchor="middle" font-size="16" fill="${MUTED}">${day}</text>`,
  ).join('\n    ');
  return `${grid}
    ${polyline(lastMonth, `stroke="#94A3B8" stroke-width="3"`)}
    ${polyline(projected, `stroke="${color}" stroke-width="4" stroke-dasharray="10 8"`)}
    ${polyline(actual, `stroke="${color}" stroke-width="5"`)}
    ${marker(lastActual, lastActual >= 0 ? actual[lastActual] : null, '#FFFFFF')}
    ${marker(lastProjected, endValue, color)}
    ${xLabels}`;
}

function forecastChartCard(
  forecast: DailyFinanceMonthForecast,
  side: ForecastChartSide,
  title: string,
  color: string,
  glyph: string,
  x: number,
  y: number,
  width: number,
): string {
  const height = FORECAST_CHART_HEIGHT + 150;
  const legendX = x + width - 560;
  return `${card(x, y, width, height)}
    ${iconTile(x + 28, y + 24, 44, color, glyph)}
    <text x="${x + 88}" y="${y + 54}" font-size="19" font-weight="800" fill="${INK}">${escapeXml(title)}</text>
    <line x1="${legendX}" y1="${y + 48}" x2="${legendX + 28}" y2="${y + 48}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
    <text x="${legendX + 38}" y="${y + 54}" font-size="16" fill="${MUTED}">этот месяц</text>
    <line x1="${legendX + 150}" y1="${y + 48}" x2="${legendX + 178}" y2="${y + 48}" stroke="${color}" stroke-width="4" stroke-dasharray="8 6"/>
    <text x="${legendX + 188}" y="${y + 54}" font-size="16" fill="${MUTED}">прогноз</text>
    <line x1="${legendX + 280}" y1="${y + 48}" x2="${legendX + 308}" y2="${y + 48}" stroke="#94A3B8" stroke-width="3" stroke-linecap="round"/>
    <text x="${legendX + 318}" y="${y + 54}" font-size="16" fill="${MUTED}">прошлый месяц</text>
    ${forecastChart(forecast.days, side, color, x + 116, y + 92, width - 116 - 40, FORECAST_CHART_HEIGHT)}`;
}

/** The forecast image: month-end figures at this pace, then each side's running total against last month. */
export function buildForecastReportSvg(input: DailyFinanceReportInput): string | null {
  const forecast = input.monthForecast;
  if (!forecast) return null;
  const tiles = forecastSection(forecast, CONTENT_Y);
  const chartHeight = FORECAST_CHART_HEIGHT + 150;
  const clubY = CONTENT_Y + tiles.height + 24;
  const barY = clubY + chartHeight + 24;
  const showPlaystation = forecast.playstation.incomeToDate > 0 || forecast.playstation.lastMonthIncome > 0;
  const playstationY = barY + chartHeight + 24;
  const footerY = (showPlaystation ? playstationY + chartHeight : barY + chartHeight) + 20;
  const height = footerY + 60;
  return svgDocument(height, `${reportHeader('ПРОГНОЗ МЕСЯЦА', `${input.clubName} · с 1-го числа по ${input.businessDateLabel}`, GLYPH_TREND_UP)}

    ${tiles.svg}

    ${forecastChartCard(forecast, 'gameClub', 'ДОХОД КЛУБА С НАЧАЛА МЕСЯЦА', BLUE, GLYPH_MONITOR, PAGE_X, clubY, PAGE_WIDTH)}

    ${forecastChartCard(forecast, 'bar', 'ПРОДАЖИ БАРА С НАЧАЛА МЕСЯЦА', ORANGE, GLYPH_BAG, PAGE_X, barY, PAGE_WIDTH)}

    ${showPlaystation ? forecastChartCard(forecast, 'playstation', 'PLAYSTATION С НАЧАЛА МЕСЯЦА', PURPLE, GLYPH_GAMEPAD, PAGE_X, playstationY, PAGE_WIDTH) : ''}

    ${reportFooter(footerY, 'Прогноз — если остаток месяца пройдёт в текущем среднем темпе в день. Суммы в UZS.')}`);
}

/** The month so far: where its money is, the forecast, money flows, trends and key indicators. */
export function buildMonthlyFinanceReportSvg(input: DailyFinanceReportInput): string {
  const dailyPoints = input.monthDailyGameClubIncome ?? [];
  let y = CONTENT_Y;
  const next = (height: number) => {
    const top = y;
    y += height + 24;
    return top;
  };

  const monthMoney = input.monthMoney ? monthMoneySection(input.monthMoney, y) : null;
  if (monthMoney) next(monthMoney.height);
  const clubFlow = sankeySection(input.monthGameClubSankey, 'КУДА УХОДЯТ ДЕНЬГИ КЛУБА', 'Клуб', y);
  next(clubFlow.height);
  const barFlow = sankeySection(input.monthBarSankey, 'КУДА УХОДЯТ ДЕНЬГИ БАРА', 'Бар', y);
  next(barFlow.height);

  const trendHeight = 520;
  const trendY = next(trendHeight);
  const showPlaystation = input.monthDailyPlaystationIncome !== undefined;
  const playstationHeight = 360;
  const playstationY = showPlaystation ? next(playstationHeight) : 0;
  const kpiHeight = 300;
  const kpiY = next(kpiHeight);
  const footerY = y - 4;
  const height = footerY + 60;

  const kpiWidth = (PAGE_WIDTH - 4 * 16) / 5;
  const kpiX = (index: number) => PAGE_X + index * (kpiWidth + 16);

  return svgDocument(height, `${reportHeader('ИТОГИ МЕСЯЦА', `${input.clubName} · с 1-го числа по ${input.businessDateLabel}`, GLYPH_BARS)}

    ${monthMoney?.svg ?? ''}

    ${clubFlow.svg}

    ${barFlow.svg}

    ${card(PAGE_X, trendY, PAGE_WIDTH, trendHeight)}
    <text x="${PAGE_X + 28}" y="${trendY + 50}" font-size="19" font-weight="800" fill="${INK}">ДИНАМИКА ДОХОДА КЛУБА ЗА МЕСЯЦ</text>
    ${incomeChart(dailyPoints, PAGE_X + 116, trendY + 84, PAGE_WIDTH - 116 - 40, 300)}
    ${card(PAGE_X + 24, trendY + trendHeight - 100, PAGE_WIDTH - 48, 76, '#F8FAFC')}
    <text x="${PAGE_X + 48}" y="${trendY + trendHeight - 68}" font-size="17" fill="${TEXT}">Средний доход клуба / день</text>
    ${moneyText(PAGE_X + 48, trendY + trendHeight - 36, input.averageDailyGameClubIncome, 26, PURPLE)}
    ${changeBadge(WIDTH - PAGE_X - 196, trendY + trendHeight - 66, input.averageDailyGameClubIncomeChange, 20)}
    <text x="${WIDTH - PAGE_X - 196}" y="${trendY + trendHeight - 40}" font-size="16" fill="${MUTED}">к прошлому месяцу</text>

    ${showPlaystation ? playstationSection(input, playstationY, playstationHeight) : ''}

    ${card(PAGE_X, kpiY, PAGE_WIDTH, kpiHeight, '#FFFFFF')}
    <text x="${PAGE_X + 28}" y="${kpiY + 44}" font-size="20" font-weight="800" fill="${INK}">КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ</text>
    ${kpiTile(kpiX(0) + 12, kpiY + 62, kpiWidth - 12, GREEN, GLYPH_WALLET, ['ОСТАТОК', 'КЛУБА'], input.gameClubMoneyLeft, 'за месяц')}
    ${kpiTile(kpiX(1) + 6, kpiY + 62, kpiWidth - 12, PURPLE, GLYPH_BARS, ['СРЕДНИЙ', 'ДОХОД / ДЕНЬ'], input.averageDailyGameClubIncome, 'к прошлому месяцу', input.averageDailyGameClubIncomeChange)}
    ${kpiTile(kpiX(2) + 3, kpiY + 62, kpiWidth - 12, ORANGE, GLYPH_BAG, ['ДОХОД БАРА', 'ЗА МЕСЯЦ'], input.barMoneyLeft, 'к прошлому месяцу', input.barMoneyLeftChange)}
    ${kpiTile(kpiX(3), kpiY + 62, kpiWidth - 12, SLATE, GLYPH_BOX, ['СТОИМОСТЬ', 'СКЛАДА'], input.inventoryValue, 'к прошлому месяцу', input.inventoryValueChange)}
    ${kpiTile(kpiX(4) - 6, kpiY + 62, kpiWidth - 6, RED, GLYPH_ALERT, ['АКТИВНЫЕ', 'ДОЛГИ'], input.activeDebts, 'долги клиентов')}

    ${reportFooter(footerY, `Все суммы указаны в UZS, с 1-го числа по ${input.businessDateLabel}. Прогноз — на третьем изображении.`)}`);
}

/** One business's (or PlayStation's) money today, with its average per day this month and the change. */
function incomeTile(
  x: number,
  y: number,
  label: string,
  color: string,
  fill: string,
  border: string,
  glyph: string,
  today: number,
  averagePerDay: number | undefined,
  change: number | null | undefined,
  width = 400,
): string {
  return `${card(x, y, width, 144, fill, border)}
    ${iconTile(x + 20, y + 22, 56, color, glyph)}
    <text x="${x + 96}" y="${y + 44}" font-size="18" font-weight="800" fill="${color}">${escapeXml(label)}</text>
    ${moneyText(x + 96, y + 82, today, 28, color)}
    <text x="${x + 96}" y="${y + 114}" font-size="15" fill="${MUTED}">в среднем / день</text>
    <text x="${x + 96}" y="${y + 134}" font-size="17" font-weight="800" fill="${INK}">${escapeXml(averagePerDay === undefined ? '—' : `${amount(averagePerDay)} UZS`)}</text>
    ${changeBadge(x + width - 100, y + 134, change, 17)}`;
}

/** PlayStation money each day this month, with the running average per day. */
function playstationSection(input: DailyFinanceReportInput, y: number, height: number): string {
  const chartLeft = PAGE_X + 116;
  const chartWidth = PAGE_WIDTH - 116 - 40;
  return `${card(PAGE_X, y, PAGE_WIDTH, height)}
    ${iconTile(PAGE_X + 28, y + 24, 44, PURPLE, GLYPH_GAMEPAD)}
    <text x="${PAGE_X + 88}" y="${y + 54}" font-size="19" font-weight="800" fill="${INK}">ПРОДАЖИ PLAYSTATION ЗА МЕСЯЦ</text>
    <rect x="${WIDTH - PAGE_X - 400}" y="${y + 40}" width="16" height="16" rx="3" fill="${PURPLE}" fill-opacity="0.8"/>
    <text x="${WIDTH - PAGE_X - 376}" y="${y + 54}" font-size="16" fill="${MUTED}">за день</text>
    <line x1="${WIDTH - PAGE_X - 290}" y1="${y + 48}" x2="${WIDTH - PAGE_X - 262}" y2="${y + 48}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <text x="${WIDTH - PAGE_X - 252}" y="${y + 54}" font-size="16" fill="${MUTED}">средние продажи / день</text>
    ${playstationChart(input.monthDailyPlaystationIncome ?? [], chartLeft, y + 96, chartWidth, height - 160)}`;
}

/** The write-offs image as PNG, or null when the report date had no write-offs or corrections. */
export async function renderStockAdjustmentsReportPng(input: DailyFinanceReportInput): Promise<Buffer | null> {
  if (!hasStockAdjustments(input)) return null;
  assertReportFontsAvailable();
  const svg = buildStockAdjustmentsReportSvg(input);
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

export async function renderDailyFinanceReportPng(input: DailyFinanceReportInput): Promise<Buffer> {
  assertReportFontsAvailable();
  const svg = buildDailyFinanceReportSvg(input);
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

/** The forecast image, or null when the report has no forecast. */
export async function renderForecastReportPng(input: DailyFinanceReportInput): Promise<Buffer | null> {
  const svg = buildForecastReportSvg(input);
  if (!svg) return null;
  assertReportFontsAvailable();
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

/** The month image: sent beside the day image in the same album. */
export async function renderMonthlyFinanceReportPng(input: DailyFinanceReportInput): Promise<Buffer> {
  assertReportFontsAvailable();
  const svg = buildMonthlyFinanceReportSvg(input);
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}
