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
import {
  CHART_Y_AXIS_WIDTH,
  ChartLegendToggle,
  ChartTooltipBody,
  chartColors,
  formatAxis,
  seriesOpacity,
  useSeriesVisibility,
  type ChartLegendItem,
} from '@/components/dashboard/ChartCard';
import { formatDateShort, formatMonthShort, formatYearMonth } from '@/lib/formatters';
import {
  SPENDING_GROUPS,
  type DailyAnalysisRow,
  type MonthlyAnalysisRow,
  type PlaystationDayRow,
} from '@/lib/calculations/financialAnalysis';
import { SPENDING_GROUP_COLORS } from './analysisFormat';

export function LegendItem({ color, label, line = false, dashed = false }: { color: string; label: string; line?: boolean; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {dashed
        ? <span className="w-4 border-t-2 border-dashed" style={{ borderColor: color }} aria-hidden="true" />
        : line
        ? <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        : <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />}
      {label}
    </span>
  );
}

export const axisProps = {
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
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  // Legend order: the spending stacks, then each side's money in. The tooltip lists them in the same order.
  const series: ChartLegendItem[] = [
    ...SPENDING_GROUPS.map((group) => ({ key: group as string, label: names[group], color: SPENDING_GROUP_COLORS[group], swatch: 'square' as const })),
    { key: 'gameClubIncome', label: names.gameClubIncome, color: chartColors.primary, swatch: 'line' },
    { key: 'barSales', label: names.barSales, color: chartColors.orange, swatch: 'line' },
  ];
  const keys = series.map((item) => item.key);

  return (
    <>
      <div className="mt-3">
        <ChartLegendToggle label={t('dailyTitle')} items={series} hidden={hidden} onToggle={(key) => toggle(key, keys)} onFocus={setFocused} />
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart accessibilityLayer data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="20%">
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={16} />
            <YAxis {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
            <Tooltip
              cursor={{ fill: chartColors.cursor }}
              content={({ active, label, payload }) => (
                <ChartTooltipBody active={active} label={label} payload={payload} series={series} currency={currency} />
              )}
            />
            <Bar
              dataKey="gameClubExpenses"
              stackId="gameClub"
              hide={hidden.has('gameClubExpenses')}
              fill={SPENDING_GROUP_COLORS.gameClubExpenses}
              fillOpacity={0.85 * seriesOpacity('gameClubExpenses', focused)}
              maxBarSize={18}
              radius={[3, 3, 0, 0]}
            />
            <Bar dataKey="barCost" stackId="bar" hide={hidden.has('barCost')} fill={SPENDING_GROUP_COLORS.barCost} fillOpacity={0.85 * seriesOpacity('barCost', focused)} maxBarSize={18} />
            <Bar
              dataKey="barExpenses"
              stackId="bar"
              hide={hidden.has('barExpenses')}
              fill={SPENDING_GROUP_COLORS.barExpenses}
              fillOpacity={0.85 * seriesOpacity('barExpenses', focused)}
              maxBarSize={18}
              radius={[3, 3, 0, 0]}
            />
            <Line dataKey="gameClubIncome" type="monotone" hide={hidden.has('gameClubIncome')} stroke={chartColors.primary} strokeOpacity={seriesOpacity('gameClubIncome', focused)} strokeWidth={2} dot={data.length <= 14 ? { r: 2.5 } : false} />
            <Line dataKey="barSales" type="monotone" hide={hidden.has('barSales')} stroke={chartColors.orange} strokeOpacity={seriesOpacity('barSales', focused)} strokeWidth={2} dot={data.length <= 14 ? { r: 2.5 } : false} />
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
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const series: ChartLegendItem[] = [
    { key: 'gameClubIncome', label: names.gameClubIncome, color: chartColors.primary, swatch: 'square' },
    { key: 'gameClubLeft', label: names.gameClubLeft, color: chartColors.success, swatch: 'line' },
    { key: 'barSales', label: names.barSales, color: chartColors.orange, swatch: 'square' },
    { key: 'barLeft', label: names.barLeft, color: chartColors.purple, swatch: 'line' },
  ];
  const keys = series.map((item) => item.key);
  // The tooltip lists the bars, then the lines, as they are drawn.
  const tooltipSeries = [series[0], series[2], series[1], series[3]];

  return (
    <>
      <div className="mt-3">
        <ChartLegendToggle label={t('monthlyTitle')} items={series} hidden={hidden} onToggle={(key) => toggle(key, keys)} onFocus={setFocused} />
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
            <YAxis {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
            <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
            <Tooltip
              cursor={{ fill: chartColors.cursor }}
              content={({ active, label, payload }) => (
                <ChartTooltipBody active={active} label={monthTitle(String(label))} payload={payload} series={tooltipSeries} currency={currency} />
              )}
            />
            <Bar dataKey="gameClubIncome" hide={hidden.has('gameClubIncome')} fill={chartColors.primary} fillOpacity={seriesOpacity('gameClubIncome', focused)} radius={[3, 3, 0, 0]} maxBarSize={20} />
            <Bar dataKey="barSales" hide={hidden.has('barSales')} fill={chartColors.orange} fillOpacity={seriesOpacity('barSales', focused)} radius={[3, 3, 0, 0]} maxBarSize={20} />
            <Line dataKey="gameClubLeft" type="monotone" hide={hidden.has('gameClubLeft')} stroke={chartColors.success} strokeOpacity={seriesOpacity('gameClubLeft', focused)} strokeWidth={2.5} dot={data.length <= 24 ? { r: 3 } : false} />
            <Line dataKey="barLeft" type="monotone" hide={hidden.has('barLeft')} stroke={chartColors.purple} strokeOpacity={seriesOpacity('barLeft', focused)} strokeWidth={2.5} dot={data.length <= 24 ? { r: 3 } : false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** PlayStation money each day as bars, with the period's running total as a line on its own axis. */
export function PlaystationDailyChart({ data, locale, currency }: { data: PlaystationDayRow[]; locale: string; currency: string }) {
  const t = useTranslations('financialAnalysis');
  const names: Record<string, string> = { amount: t('playstationDay'), running: t('playstationRunning') };
  const chartData = data.map((row) => ({ ...row, label: formatDateShort(row.date, locale) }));
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const series: ChartLegendItem[] = [
    { key: 'amount', label: names.amount, color: chartColors.purple, swatch: 'square' },
    { key: 'running', label: names.running, color: chartColors.primary, swatch: 'line' },
  ];
  const keys = series.map((item) => item.key);

  return (
    <>
      <div className="mt-3">
        <ChartLegendToggle label={t('playstationTitle')} items={series} hidden={hidden} onToggle={(key) => toggle(key, keys)} onFocus={setFocused} />
      </div>
      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart accessibilityLayer data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={16} />
            <YAxis yAxisId="day" {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
            <YAxis yAxisId="running" orientation="right" {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
            <Tooltip
              cursor={{ fill: chartColors.cursor }}
              content={({ active, label, payload }) => (
                <ChartTooltipBody active={active} label={label} payload={payload} series={series} currency={currency} />
              )}
            />
            <Bar yAxisId="day" dataKey="amount" hide={hidden.has('amount')} fill={chartColors.purple} fillOpacity={0.85 * seriesOpacity('amount', focused)} radius={[3, 3, 0, 0]} maxBarSize={18} />
            <Line yAxisId="running" dataKey="running" type="monotone" hide={hidden.has('running')} stroke={chartColors.primary} strokeOpacity={seriesOpacity('running', focused)} strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
