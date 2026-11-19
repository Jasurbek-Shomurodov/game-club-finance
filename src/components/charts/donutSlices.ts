import { rankShares, type ShareItem } from '@/lib/calculations/insights';
import { categoricalColors, chartColors } from '@/components/dashboard/ChartCard';
import type { DonutSlice } from './DonutBreakdown';

/**
 * Ranked donut slices in the fixed categorical order, the tail folded into a
 * grey "other" slice, so every donut on every page colours the same way.
 */
export function toDonutSlices(
  items: readonly ShareItem[],
  other: { key: string; label: string },
  onSelect?: (key: string) => void,
): DonutSlice[] {
  let colorIndex = 0;
  return rankShares(items, categoricalColors.length, other).map((slice) => ({
    key: slice.key,
    label: slice.label,
    value: slice.value,
    share: slice.share,
    color: slice.other ? chartColors.gray : categoricalColors[colorIndex++],
    onSelect: onSelect && !slice.other ? () => onSelect(slice.key) : undefined,
  }));
}
