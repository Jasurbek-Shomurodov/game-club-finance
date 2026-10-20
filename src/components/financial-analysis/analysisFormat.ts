import { chartColors, formatAxis } from '@/components/dashboard/ChartCard';
import { intlLocaleFor } from '@/lib/formatters';
import {
  BAR_COST_TARGET,
  OTHER_CATEGORY,
  PROFIT_TARGET,
  type CategoryAmount,
  type IncomeSourceKey,
  type SpendingGroupKey,
} from '@/lib/calculations/financialAnalysis';
import {
  BAR_LEFT,
  BAR_LOSS,
  BAR_UNIT,
  GAME_CLUB_LEFT,
  GAME_CLUB_LOSS,
  GAME_CLUB_UNIT,
  MORE_PAYMENTS,
  NO_COMMENT,
  PAID_FROM_BAR,
  PAID_FROM_GAME_CLUB,
} from '@/lib/calculations/sankeyDrill';

/** Compact money for dense chart labels ("1.2M"); full amounts stay in tooltips. */
export function formatCompactMoney(amount: number, locale: string): string {
  return formatAxis(amount, locale);
}

export function formatShare(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(intlLocaleFor(locale), {
    maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0,
  }).format(value)}%`;
}

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

const CATEGORY_PALETTE = [chartColors.danger, chartColors.primary, chartColors.purple, '#0e9fb3', chartColors.warning, '#d6408f', chartColors.axis];

/** One colour per expense category, shared by the sankey, donut and comparison bars. */
export function categoryColors(topCategories: CategoryAmount[]): Record<string, string> {
  const colors: Record<string, string> = {
    [BAR_COST_TARGET]: chartColors.orange,
    [PROFIT_TARGET]: chartColors.success,
    [OTHER_CATEGORY]: chartColors.gray,
  };
  topCategories
    .filter((row) => row.category !== OTHER_CATEGORY)
    .forEach((row, index) => {
      colors[row.category] = CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
    });
  return colors;
}

const DRILL_COLORS: Record<string, string> = {
  [GAME_CLUB_UNIT]: chartColors.primary,
  [BAR_UNIT]: chartColors.orange,
  [GAME_CLUB_LEFT]: chartColors.success,
  [BAR_LEFT]: chartColors.success,
  [GAME_CLUB_LOSS]: chartColors.danger,
  [BAR_LOSS]: chartColors.danger,
  [PAID_FROM_GAME_CLUB]: chartColors.primary,
  [PAID_FROM_BAR]: chartColors.orange,
  [NO_COMMENT]: chartColors.gray,
  [MORE_PAYMENTS]: chartColors.gray,
};

/**
 * Colour of a node in a drill-down Sankey: income sources and categories keep
 * their colours from the main flow; anything else takes the palette by position.
 */
export function drillNodeColor(key: string, index: number, colors: Record<string, string>): string {
  return DRILL_COLORS[key]
    ?? SOURCE_COLORS[key as IncomeSourceKey]
    ?? colors[key]
    ?? CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}
