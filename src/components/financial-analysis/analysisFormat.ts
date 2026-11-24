import { chartColors, extendedCategoricalColors, formatAxis } from '@/components/dashboard/ChartCard';
import { formatCurrency, intlLocaleFor } from '@/lib/formatters';
import {
  BAR_COST_TARGET,
  OTHER_CATEGORY,
  type CategoryAmount,
  type IncomeSourceKey,
  type SpendingGroupKey,
} from '@/lib/calculations/financialAnalysis';
import {
  BAR_LEFT,
  GAME_CLUB_LEFT,
  MORE_PAYMENTS,
  NO_COMMENT,
  PAID_FROM_BAR,
  PAID_FROM_GAME_CLUB,
} from '@/lib/calculations/sankeyDrill';

/** Compact money for dense chart labels ("1.2M"); full amounts stay in tooltips. */
export function formatCompactMoney(amount: number, locale: string): string {
  return formatAxis(amount, locale);
}

/** The translated suffixes of a compact amount: "{value}K" / "{value} тыс" / "{value} ming", and the same for millions. */
export interface CompactUnits {
  thousand: (value: string) => string;
  million: (value: string) => string;
}

/**
 * A short amount for a dense cell, with units from the messages so it reads
 * the same in every browser: thousands whole ("610K"), millions with up to one
 * decimal ("2.5M", "2,5 mln"), and amounts under a thousand as they are. The
 * full amount belongs in the cell's accessible label.
 */
export function formatCompactAmount(amount: number, locale: string, units: CompactUnits): string {
  const absolute = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const sign = amount < 0 && Math.round(absolute) > 0 ? '−' : '';
  if (absolute < 1_000) return `${sign}${formatCurrency(absolute)}`;
  const number = (value: number) => new Intl.NumberFormat(intlLocaleFor(locale), { maximumFractionDigits: 1 })
    .format(value)
    .replace(/[  ]/g, ' ');
  const thousands = Math.round(absolute / 1_000);
  // 999 600 rounds to a thousand thousands: say "1M", not "1000K".
  if (thousands < 1_000) return `${sign}${units.thousand(number(thousands))}`;
  return `${sign}${units.million(number(Math.round(absolute / 100_000) / 10))}`;
}

export function formatShare(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(intlLocaleFor(locale), {
    maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0,
  }).format(value)}%`;
}

/** Icon colour for each side of the club, matching its colour in the charts. */
export const SIDE_ICON_CLASS = {
  gameClub: 'text-primary-600',
  bar: 'text-orange-500',
} as const;

export const SOURCE_COLORS: Record<IncomeSourceKey, string> = {
  computers: chartColors.primary,
  playstation: chartColors.purple,
  bar: chartColors.orange,
  debts: chartColors.warning,
  shortfall: chartColors.danger,
};

export const SPENDING_GROUP_COLORS: Record<SpendingGroupKey, string> = {
  barCost: chartColors.orange,
  gameClubExpenses: chartColors.danger,
  barExpenses: chartColors.purple,
};

// Seven named categories, in the chart palette's fixed order (the first five match the Dashboard donut).
const CATEGORY_PALETTE = extendedCategoricalColors;

/** One colour per expense category, shared by the sankeys, donut and comparison bars. */
export function categoryColors(topCategories: CategoryAmount[]): Record<string, string> {
  const colors: Record<string, string> = {
    [BAR_COST_TARGET]: chartColors.orange,
    [OTHER_CATEGORY]: chartColors.gray,
  };
  topCategories
    .filter((row) => row.category !== OTHER_CATEGORY)
    .forEach((row, index) => {
      // Never cycle back to a hue already in use: anything past the palette is drawn like the folded rest.
      colors[row.category] = CATEGORY_PALETTE[index] ?? chartColors.gray;
    });
  return colors;
}

const DRILL_COLORS: Record<string, string> = {
  [GAME_CLUB_LEFT]: chartColors.success,
  [BAR_LEFT]: chartColors.success,
  [PAID_FROM_GAME_CLUB]: chartColors.primary,
  [PAID_FROM_BAR]: chartColors.orange,
  [NO_COMMENT]: chartColors.gray,
  [MORE_PAYMENTS]: chartColors.gray,
};

/**
 * Colour of a node in a money-flow Sankey: income sources and categories keep
 * their shared colours; anything else takes the palette by position, and
 * nodes past its end are grey rather than a repeated hue.
 */
export function drillNodeColor(key: string, index: number, colors: Record<string, string>): string {
  return DRILL_COLORS[key]
    ?? SOURCE_COLORS[key as IncomeSourceKey]
    ?? colors[key]
    ?? CATEGORY_PALETTE[index]
    ?? chartColors.gray;
}
