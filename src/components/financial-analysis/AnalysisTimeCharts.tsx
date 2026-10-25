'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslations } from 'next-intl';
import { chartColors, chartTooltipStyle, formatAxis } from '@/components/dashboard/ChartCard';
import { formatCurrency, formatDateShort, formatMonthShort, formatYearMonth } from '@/lib/formatters';
import {
  SPENDING_GROUPS,
  type DailyAnalysisRow,
  type MonthlyAnalysisRow,
} from '@/lib/calculations/financialAnalysis';
import { SPENDING_GROUP_COLORS } from './analysisFormat';

function LegendItem({ color, label, line = false }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {line
        ? <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        : <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />}
      {label}
    </span>
  );
}

const axisProps = {
  tick: { fontSize: 11, fill: chartColors.axis },
  tickLine: false,
} as const;

/**
 * Daily money of each side: the game club's and the bar's spending as separate
 * stacks, with each side's money in as its own line. The sides are never summed.
 */
export function DailyFlowChart({ data, locale, currency }: { data: DailyAnalysisRow[]; locale: string; currency: string }) {
  const t = useTranslations('financialAnalysis');
  const names: Record<string, string> = {
    gameClubIncome: t('gameClubIncome'),
    barSales: t('barSales'),
    barCost: t('barCost'),
    gameClubExpenses: t('gameClubExpenses'),
    barExpenses: t('barExpenses'),
  };
  const chartData = data.map((row) => ({ ...row, label: formatDateShort(row.date, locale) }));

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-gray-500">
        {SPENDING_GROUPS.map((group) => <LegendItem key={group} color={SPENDING_GROUP_COLORS[group]} label={names[group]} />)}
        <LegendItem color={chartColors.primary} label={names.gameClubIncome} line />
        <LegendItem color={chartColors.orange} label={names.barSales} line />
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart accessibilityLayer data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="20%">
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={16} />
            <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
            <Tooltip
              {...chartTooltipStyle}
              cursor={{ fill: chartColors.cursor }}
              formatter={(value, name) => [`${formatCurrency(Number(value))} ${currency}`, names[String(name)] ?? String(name)]}
            />
            <Bar
              dataKey="gameClubExpenses"
              stackId="gameClub"
              fill={SPENDING_GROUP_COLORS.gameClubExpenses}
              fillOpacity={0.85}
              maxBarSize={18}
              radius={[3, 3, 0, 0]}
            />
            <Bar dataKey="barCost" stackId="bar" fill={SPENDING_GROUP_COLORS.barCost} fillOpacity={0.85} maxBarSize={18} />
            <Bar
              dataKey="barExpenses"
              stackId="bar"
              fill={SPENDING_GROUP_COLORS.barExpenses}
              fillOpacity={0.85}
              maxBarSize={18}
              radius={[3, 3, 0, 0]}
            />
            <Line dataKey="gameClubIncome" type="monotone" stroke={chartColors.primary} strokeWidth={2} dot={data.length <= 14 ? { r: 2.5 } : false} />
            <Line dataKey="barSales" type="monotone" stroke={chartColors.orange} strokeWidth={2} dot={data.length <= 14 ? { r: 2.5 } : false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** Each side's money in per month as bars, with what that side had left as a line. */
export function MonthlyTrendChart({ data, locale, currency }: { data: MonthlyAnalysisRow[]; locale: string; currency: string }) {
  const t = useTranslations('financialAnalysis');
  const names: Record<string, string> = {
    gameClubIncome: t('gameClubIncome'),
    gameClubLeft: t('drill.gameClubLeft'),
    barSales: t('barSales'),
    barLeft: t('drill.barLeft'),
  };
  const monthTitle = (month: string) => formatYearMonth(month.slice(0, 7), locale);

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-gray-500">
        <LegendItem color={chartColors.primary} label={names.gameClubIncome} />
        <LegendItem color={chartColors.success} label={names.gameClubLeft} line />
        <LegendItem color={chartColors.orange} label={names.barSales} />
        <LegendItem color={chartColors.purple} label={names.barLeft} line />
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart accessibilityLayer data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis
              dataKey="month"
              {...axisProps}
              axisLine={{ stroke: chartColors.grid }}
              interval={data.length > 12 ? 'preserveStartEnd' : 0}
              tickFormatter={(month: string) => formatMonthShort(month, locale)}
            />
            <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
            <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
            <Tooltip
              {...chartTooltipStyle}
              cursor={{ fill: chartColors.cursor }}
              labelFormatter={(month) => monthTitle(String(month))}
              formatter={(value, name) => [`${formatCurrency(Number(value))} ${currency}`, names[String(name)] ?? String(name)]}
            />
            <Bar dataKey="gameClubIncome" fill={chartColors.primary} radius={[3, 3, 0, 0]} maxBarSize={20} />
            <Bar dataKey="barSales" fill={chartColors.orange} radius={[3, 3, 0, 0]} maxBarSize={20} />
            <Line dataKey="gameClubLeft" type="monotone" stroke={chartColors.success} strokeWidth={2.5} dot={data.length <= 24 ? { r: 3 } : false} />
            <Line dataKey="barLeft" type="monotone" stroke={chartColors.purple} strokeWidth={2.5} dot={data.length <= 24 ? { r: 3 } : false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
