import { chartColors, formatAxis } from '@/components/dashboard/ChartCard';
import {
  BAR_COST_TARGET,
  OTHER_CATEGORY,
  PROFIT_TARGET,
  type CategoryAmount,
  type IncomeSourceKey,
  type SpendingGroupKey,
} from '@/lib/calculations/financialAnalysis';

/** Compact money for dense chart labels ("1.2M"); full amounts stay in tooltips. */
export function formatCompactMoney(amount: number, locale: string): string {
  return formatAxis(amount, locale);
}

export function formatShare(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(locale === 'en' ? 'en-GB' : locale === 'uz' ? 'uz-Latn-UZ' : 'ru-RU', {
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

const CATEGORY_PALETTE = ['#e0453f', '#2f52e0', '#7c5cf2', '#0e9fb3', '#e39a1e', '#d6408f', '#5b6b84'];

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
