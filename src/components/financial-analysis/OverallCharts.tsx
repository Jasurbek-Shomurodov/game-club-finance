'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
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
import {
  capitalizeFirst,
  formatCurrency,
  formatDate,
  formatDateShort,
  formatMonthShort,
  formatYearMonth,
} from '@/lib/formatters';
import type {
  ForecastSide,
  Granularity,
  HeatmapCell,
  MonthForecast,
  OwnerMonthRow,
  PeriodSeriesRow,
  ProfitMonthRow,
  WeekdayPatternRow,
  WeeklyAverageRow,
  YearOverYear,
} from '@/lib/calculations/analysisSeries';
import { OTHER_CATEGORY, type CategoryAmount } from '@/lib/calculations/financialAnalysis';
import { axisProps } from './AnalysisTimeCharts';
import { formatShare, SOURCE_COLORS } from './analysisFormat';

type Side = 'gameClub' | 'bar';

const SIDE_COLOR: Record<ForecastSide, string> = { gameClub: chartColors.primary, bar: chartColors.orange, playstation: chartColors.purple };

/** Axis tick and tooltip title of a bucket: its day, its week's first day or its month. */
function periodLabels(granularity: Granularity, locale: string) {
  return {
    tick: (period: string) => (granularity === 'month' ? formatMonthShort(period, locale) : formatDateShort(period, locale)),
    title: (period: string, end?: string) => {
      if (granularity === 'day') return formatDate(period, locale);
      if (granularity === 'month') return capitalizeFirst(formatYearMonth(period.slice(0, 7), locale), locale);
      return `${formatDateShort(period, locale)} – ${formatDateShort(end ?? period, locale)}`;
    },
  };
}

function ChartFrame({ children }: { children: ReactElement }) {
  return (
    <div className="mt-3 h-64">
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

type TooltipSeries = ComponentProps<typeof ChartTooltipBody>['series'];

interface TooltipContentProps {
  active?: boolean;
  label?: unknown;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
}

/** The shared tooltip card for a chart: `title` writes the hovered bucket, `series` its rows in drawing order. */
function tooltipContent(currency: string, title: (label: unknown) => ReactNode, series: TooltipSeries | ((label: unknown) => TooltipSeries)) {
  function OverallTooltip({ active, label, payload }: TooltipContentProps) {
    return (
      <ChartTooltipBody
        active={active}
        label={title(label)}
        payload={payload}
        series={typeof series === 'function' ? series(label) : series}
        currency={currency}
      />
    );
  }
  return OverallTooltip;
}

/**
 * The legend of a chart as pills that show or hide each mark, and what the
 * chart needs to follow it: which keys are hidden and how strongly to draw a
 * mark while another pill is hovered.
 */
function useChartLegend(label: string, items: readonly ChartLegendItem[]) {
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const keys = items.map((item) => item.key);
  return {
    shown: (key: string) => !hidden.has(key),
    opacity: (key: string, base = 1) => base * seriesOpacity(key, focused),
    legend: (
      <div className="mt-3">
        <ChartLegendToggle label={label} items={items} hidden={hidden} onToggle={(key) => toggle(key, keys)} onFocus={setFocused} />
      </div>
    ),
  };
}

/** One side per chart: money in and spending as bars, profit as a line. */
export function SideFlowChart({ rows, side, granularity, locale, currency }: {
  rows: PeriodSeriesRow[];
  side: Side;
  granularity: Granularity;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const income = side === 'gameClub' ? 'gameClubIncome' : 'barSales';
  const spent = side === 'gameClub' ? 'gameClubSpent' : 'barSpent';
  const left = side === 'gameClub' ? 'gameClubLeft' : 'barLeft';
  const labels = periodLabels(granularity, locale);
  const ends = new Map(rows.map((row) => [row.period, row.end]));
  const series: ChartLegendItem[] = [
    { key: income, label: t(side === 'gameClub' ? 'moneyIn' : 'barSalesIn'), color: SIDE_COLOR[side], swatch: 'square' },
    { key: spent, label: t('spent'), color: chartColors.danger, swatch: 'square' },
    { key: left, label: t('profit'), color: chartColors.success, swatch: 'line' },
  ];
  const { legend, shown, opacity } = useChartLegend(t(side === 'gameClub' ? 'sideFlowGameClubTitle' : 'sideFlowBarTitle'), series);

  return (
    <>
      {legend}
      <ChartFrame>
        <ComposedChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="period" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={12} tickFormatter={labels.tick} />
          <YAxis {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
          <Tooltip
            cursor={{ fill: chartColors.cursor }}
            content={tooltipContent(currency, (period) => labels.title(String(period), ends.get(String(period))), series)}
          />
          <Bar dataKey={income} hide={!shown(income)} fill={SIDE_COLOR[side]} fillOpacity={opacity(income)} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Bar dataKey={spent} hide={!shown(spent)} fill={chartColors.danger} fillOpacity={opacity(spent, 0.8)} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Line dataKey={left} hide={!shown(left)} type="monotone" stroke={chartColors.success} strokeOpacity={opacity(left)} strokeWidth={2.5} dot={rows.length <= 31 ? { r: 2.5 } : false} />
        </ComposedChart>
      </ChartFrame>
    </>
  );
}

/** Each side's running profit across the drawn buckets. */
export function CumulativeProfitChart({ rows, granularity, locale, currency }: {
  rows: PeriodSeriesRow[];
  granularity: Granularity;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const labels = periodLabels(granularity, locale);
  const ends = new Map(rows.map((row) => [row.period, row.end]));
  const series: ChartLegendItem[] = [
    { key: 'gameClubCumulative', label: t('drill.gameClubLeft'), color: chartColors.primary, swatch: 'square' },
    { key: 'barCumulative', label: t('drill.barLeft'), color: chartColors.orange, swatch: 'square' },
  ];
  const { legend, shown, opacity } = useChartLegend(t('cumulativeTitle'), series);

  return (
    <>
      {legend}
      <ChartFrame>
        <AreaChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="cumulative-gameClub" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartColors.primary} stopOpacity={0.35} />
              <stop offset="100%" stopColor={chartColors.primary} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="cumulative-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartColors.orange} stopOpacity={0.35} />
              <stop offset="100%" stopColor={chartColors.orange} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="period" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={12} tickFormatter={labels.tick} />
          <YAxis {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
          <Tooltip content={tooltipContent(currency, (period) => labels.title(String(period), ends.get(String(period))), series)} />
          <Area dataKey="gameClubCumulative" hide={!shown('gameClubCumulative')} type="monotone" stroke={chartColors.primary} strokeOpacity={opacity('gameClubCumulative')} strokeWidth={2} fill="url(#cumulative-gameClub)" fillOpacity={opacity('gameClubCumulative')} />
          <Area dataKey="barCumulative" hide={!shown('barCumulative')} type="monotone" stroke={chartColors.orange} strokeOpacity={opacity('barCumulative')} strokeWidth={2} fill="url(#cumulative-bar)" fillOpacity={opacity('barCumulative')} />
        </AreaChart>
      </ChartFrame>
    </>
  );
}

/** Game club money in per bucket, stacked by source. */
export function IncomeMixChart({ rows, granularity, locale, currency }: {
  rows: PeriodSeriesRow[];
  granularity: Granularity;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const keys = ['computers', 'playstation', 'debts'] as const;
  const labels = periodLabels(granularity, locale);
  const ends = new Map(rows.map((row) => [row.period, row.end]));
  const series: ChartLegendItem[] = keys.map((key) => ({ key, label: t(`sources.${key}`), color: SOURCE_COLORS[key], swatch: 'square' }));
  const { legend, shown, opacity } = useChartLegend(t('incomeMixTitle'), series);

  return (
    <>
      {legend}
      <ChartFrame>
        <BarChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="period" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={12} tickFormatter={labels.tick} />
          <YAxis {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <Tooltip
            cursor={{ fill: chartColors.cursor }}
            content={tooltipContent(currency, (period) => labels.title(String(period), ends.get(String(period))), series)}
          />
          {keys.map((key, index) => (
            <Bar key={key} dataKey={key} hide={!shown(key)} stackId="income" fill={SOURCE_COLORS[key]} fillOpacity={opacity(key)} maxBarSize={28} radius={index === keys.length - 1 ? [3, 3, 0, 0] : undefined} />
          ))}
        </BarChart>
      </ChartFrame>
    </>
  );
}

/** Operating expenses per bucket, stacked by category in the shared category colours. */
export function CategoryTrendChart({ rows, categories, colors, labelFor, granularity, locale, currency }: {
  rows: Array<{ period: string } & Record<string, number | string>>;
  categories: CategoryAmount[];
  colors: Record<string, string>;
  labelFor: (category: string) => string;
  granularity: Granularity;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const keys = categories.map((row) => row.category);
  const labels = periodLabels(granularity, locale);
  const colorOf = (key: string) => colors[key] ?? colors[OTHER_CATEGORY];
  const series: ChartLegendItem[] = keys.map((key) => ({ key, label: labelFor(key), color: colorOf(key), swatch: 'square' }));
  const { legend, shown, opacity } = useChartLegend(t('categoryTrendTitle'), series);

  return (
    <>
      {legend}
      <ChartFrame>
        <BarChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="period" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={12} tickFormatter={labels.tick} />
          <YAxis {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <Tooltip
            cursor={{ fill: chartColors.cursor }}
            content={tooltipContent(currency, (period) => labels.title(String(period)), series)}
          />
          {keys.map((key, index) => (
            <Bar key={key} dataKey={key} hide={!shown(key)} stackId="expenses" fill={colorOf(key)} fillOpacity={opacity(key)} maxBarSize={28} radius={index === keys.length - 1 ? [3, 3, 0, 0] : undefined} />
          ))}
        </BarChart>
      </ChartFrame>
    </>
  );
}

/**
 * One side's average money in per day for each week as bars, the week's
 * total in the tooltip, and the average over every drawn week as a dashed line.
 */
export function WeeklyAverageChart({ rows, side, average, locale, currency }: {
  rows: WeeklyAverageRow[];
  side: Side;
  average: number;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const value = side === 'gameClub' ? 'gameClubAverage' : 'barAverage';
  const total = side === 'gameClub' ? 'gameClubIncome' : 'barSales';
  const labels = periodLabels('week', locale);
  const byPeriod = new Map(rows.map((row) => [row.period, row]));
  const perDay: ChartLegendItem = { key: value, label: t('weeklyAveragePerDay'), color: SIDE_COLOR[side], swatch: 'square' };
  const { legend, shown, opacity } = useChartLegend(t(side === 'gameClub' ? 'weeklyAverageGameClubTitle' : 'weeklyAverageBarTitle'), [
    perDay,
    { key: 'overall', label: t('weeklyAverageOverall'), color: chartColors.axis, swatch: 'dashed' },
  ]);

  return (
    <>
      {legend}
      <ChartFrame>
        <ComposedChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="period" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={12} tickFormatter={labels.tick} />
          <YAxis {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(amount: number) => formatAxis(amount, locale)} />
          {shown('overall') && <ReferenceLine y={average} stroke={chartColors.axis} strokeOpacity={opacity('overall')} strokeDasharray="5 4" />}
          <Tooltip
            cursor={{ fill: chartColors.cursor }}
            content={tooltipContent(
              currency,
              (period) => labels.title(String(period), byPeriod.get(String(period))?.end),
              // The row carries the day average and, beside it, that week's total.
              (period) => {
                const row = byPeriod.get(String(period));
                const weekTotal = row ? `${formatCurrency(row[total])} ${currency}` : '';
                return [{
                  ...perDay,
                  format: (amount: number) => `${formatCurrency(amount)} ${currency} · ${t('weeklyAverageWeekTotal', { amount: weekTotal })}`,
                }];
              },
            )}
          />
          <Bar dataKey={value} hide={!shown(value)} radius={[3, 3, 0, 0]} maxBarSize={28}>
            {rows.map((row) => (
              <Cell key={row.period} fill={SIDE_COLOR[side]} fillOpacity={opacity(value, row[value] >= average ? 1 : 0.55)} />
            ))}
          </Bar>
        </ComposedChart>
      </ChartFrame>
    </>
  );
}

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Average money in per weekday, each side as its own bar. */
export function WeekdayChart({ rows, locale, currency }: { rows: WeekdayPatternRow[]; locale: string; currency: string }) {
  const t = useTranslations('financialAnalysis');
  const data = rows.map((row) => ({ ...row, label: t(`weekdays.${WEEKDAY_KEYS[row.weekday]}`) }));
  const series: ChartLegendItem[] = [
    { key: 'gameClubAverage', label: t('gameClubIncome'), color: chartColors.primary, swatch: 'square' },
    { key: 'barAverage', label: t('barSales'), color: chartColors.orange, swatch: 'square' },
  ];
  const { legend, shown, opacity } = useChartLegend(t('weekdayTitle'), series);

  return (
    <>
      {legend}
      <ChartFrame>
        <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={3} barCategoryGap="24%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} axisLine={{ stroke: chartColors.grid }} interval={0} />
          <YAxis {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <Tooltip cursor={{ fill: chartColors.cursor }} content={tooltipContent(currency, (label) => String(label), series)} />
          <Bar dataKey="gameClubAverage" hide={!shown('gameClubAverage')} fill={chartColors.primary} fillOpacity={opacity('gameClubAverage')} radius={[3, 3, 0, 0]} maxBarSize={32} />
          <Bar dataKey="barAverage" hide={!shown('barAverage')} fill={chartColors.orange} fillOpacity={opacity('barAverage')} radius={[3, 3, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ChartFrame>
    </>
  );
}

/**
 * One side's profit per month: green bars for a profit, red for a loss, the
 * monthly average as a dashed line and the margin on the right axis.
 */
export function ProfitMonthsChart({ rows, average, locale, currency }: {
  rows: ProfitMonthRow[];
  average: number;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const monthTitle = (month: string) => capitalizeFirst(formatYearMonth(month.slice(0, 7), locale), locale);
  // A month is either a profit or a loss: two series on one stack, so each can be shown or hidden by its own pill.
  const data = rows.map((row) => ({ ...row, gain: row.profit >= 0 ? row.profit : null, loss: row.profit < 0 ? row.profit : null }));
  const margin = { key: 'marginPct', label: t('margin'), color: chartColors.purple, swatch: 'line' as const };
  const { legend, shown, opacity } = useChartLegend(t('overallSection'), [
    { key: 'gain', label: t('profit'), color: chartColors.success, swatch: 'square' },
    { key: 'loss', label: t('loss'), color: chartColors.danger, swatch: 'square' },
    { key: 'average', label: t('average'), color: chartColors.axis, swatch: 'dashed' },
    margin,
  ]);
  // Both read "Profit" in the tooltip, as the one figure they are; the margin is a percentage, not money.
  const tooltipSeries: TooltipSeries = [
    { key: 'gain', label: t('profit'), color: chartColors.success },
    { key: 'loss', label: t('profit'), color: chartColors.danger },
    { ...margin, format: (value: number) => formatShare(value, locale) },
  ];

  return (
    <>
      {legend}
      <ChartFrame>
        <ComposedChart accessibilityLayer data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis
            dataKey="month"
            {...axisProps}
            axisLine={{ stroke: chartColors.grid }}
            interval={rows.length > 12 ? 'preserveStartEnd' : 0}
            tickFormatter={(month: string) => formatMonthShort(month, locale)}
          />
          <YAxis yAxisId="money" {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <YAxis yAxisId="pct" orientation="right" {...axisProps} axisLine={false} width={36} tickFormatter={(value: number) => `${value}%`} />
          <ReferenceLine yAxisId="money" y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
          {shown('average') && <ReferenceLine yAxisId="money" y={average} stroke={chartColors.axis} strokeOpacity={opacity('average')} strokeDasharray="5 4" />}
          <Tooltip
            cursor={{ fill: chartColors.cursor }}
            content={tooltipContent(currency, (month) => monthTitle(String(month)), tooltipSeries)}
          />
          <Bar yAxisId="money" dataKey="gain" stackId="profit" hide={!shown('gain')} fill={chartColors.success} fillOpacity={opacity('gain')} radius={[3, 3, 0, 0]} maxBarSize={36} />
          <Bar yAxisId="money" dataKey="loss" stackId="profit" hide={!shown('loss')} fill={chartColors.danger} fillOpacity={opacity('loss')} radius={[3, 3, 0, 0]} maxBarSize={36} />
          <Line yAxisId="pct" dataKey="marginPct" hide={!shown('marginPct')} type="monotone" stroke={chartColors.purple} strokeOpacity={opacity('marginPct')} strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </ComposedChart>
      </ChartFrame>
    </>
  );
}

/** Owner money per month: each side's withdrawals stacked under what is still left to take. */
export function OwnerMonthsChart({ rows, locale, currency }: { rows: OwnerMonthRow[]; locale: string; currency: string }) {
  const t = useTranslations('financialAnalysis');
  const monthTitle = (month: string) => capitalizeFirst(formatYearMonth(month.slice(0, 7), locale), locale);
  const series: ChartLegendItem[] = [
    { key: 'gameClubWithdrawn', label: t('tableGameClubWithdrawn'), color: chartColors.primary, swatch: 'square' },
    { key: 'gameClubLeft', label: t('gameClubLeftToTake'), color: chartColors.success, swatch: 'square' },
    { key: 'barWithdrawn', label: t('tableBarWithdrawn'), color: chartColors.orange, swatch: 'square' },
    { key: 'barLeft', label: t('barLeftToTake'), color: chartColors.purple, swatch: 'square' },
  ];
  const { legend, shown, opacity } = useChartLegend(t('ownerChartTitle'), series);

  return (
    <>
      {legend}
      <ChartFrame>
        <BarChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={4} barCategoryGap="26%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis
            dataKey="month"
            {...axisProps}
            axisLine={{ stroke: chartColors.grid }}
            interval={rows.length > 12 ? 'preserveStartEnd' : 0}
            tickFormatter={(month: string) => formatMonthShort(month, locale)}
          />
          <YAxis {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
          <Tooltip
            cursor={{ fill: chartColors.cursor }}
            content={tooltipContent(currency, (month) => monthTitle(String(month)), series)}
          />
          <Bar dataKey="gameClubWithdrawn" hide={!shown('gameClubWithdrawn')} stackId="gameClub" fill={chartColors.primary} fillOpacity={opacity('gameClubWithdrawn')} maxBarSize={30} />
          <Bar dataKey="gameClubLeft" hide={!shown('gameClubLeft')} stackId="gameClub" fill={chartColors.success} fillOpacity={opacity('gameClubLeft')} maxBarSize={30} radius={[3, 3, 0, 0]} />
          <Bar dataKey="barWithdrawn" hide={!shown('barWithdrawn')} stackId="bar" fill={chartColors.orange} fillOpacity={opacity('barWithdrawn')} maxBarSize={30} />
          <Bar dataKey="barLeft" hide={!shown('barLeft')} stackId="bar" fill={chartColors.purple} fillOpacity={opacity('barLeft')} maxBarSize={30} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartFrame>
    </>
  );
}

/**
 * This month's running money in for one side: actual so far, the dashed
 * forecast at the current pace through month end, and last month by day.
 */
export function ForecastChart({ forecast, side, locale, currency }: {
  forecast: MonthForecast;
  side: ForecastSide;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const keys = { actual: `${side}Actual`, projected: `${side}Projected`, lastMonth: `${side}LastMonth` };
  const dayTitle = (day: number) => formatDate(`${forecast.month}-${String(day).padStart(2, '0')}`, locale);
  const actual: ChartLegendItem = { key: keys.actual, label: t('forecastActual'), color: SIDE_COLOR[side], swatch: 'line' };
  const projected: ChartLegendItem = { key: keys.projected, label: t('forecastProjected'), color: SIDE_COLOR[side], swatch: 'dashed' };
  const lastMonth: ChartLegendItem = { key: keys.lastMonth, label: t('forecastLastMonth'), color: chartColors.gray, swatch: 'line' };
  const { legend, shown, opacity } = useChartLegend(
    t(side === 'gameClub' ? 'forecastGameClubTitle' : side === 'bar' ? 'forecastBarTitle' : 'forecastPlaystationTitle'),
    [actual, projected, lastMonth],
  );

  return (
    <>
      {legend}
      <ChartFrame>
        <LineChart accessibilityLayer data={forecast.days} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="day" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={12} />
          <YAxis {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
          {/* Rows in drawing order: last month, the forecast, then the actual line on top. */}
          <Tooltip content={tooltipContent(currency, (day) => dayTitle(Number(day)), [lastMonth, { ...projected, dashed: true }, actual])} />
          <Line dataKey={keys.lastMonth} hide={!shown(keys.lastMonth)} type="monotone" stroke={chartColors.gray} strokeOpacity={opacity(keys.lastMonth)} strokeWidth={1.5} dot={false} connectNulls={false} />
          <Line dataKey={keys.projected} hide={!shown(keys.projected)} type="linear" stroke={SIDE_COLOR[side]} strokeOpacity={opacity(keys.projected)} strokeWidth={2} strokeDasharray="6 4" dot={false} />
          <Line dataKey={keys.actual} hide={!shown(keys.actual)} type="monotone" stroke={SIDE_COLOR[side]} strokeOpacity={opacity(keys.actual)} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ChartFrame>
    </>
  );
}

const YEAR_COLORS = [chartColors.gray, chartColors.purple, chartColors.orange, chartColors.success, chartColors.primary];

/** One side's money in by calendar month, one bar per year. */
export function YearOverYearChart({ data, locale, currency }: { data: YearOverYear; locale: string; currency: string }) {
  const t = useTranslations('financialAnalysis');
  // The newest year takes the strongest colour.
  const colorOf = (index: number) => YEAR_COLORS[(YEAR_COLORS.length - data.years.length + index + YEAR_COLORS.length) % YEAR_COLORS.length];
  const monthLabel = (month: number) => formatMonthShort(`2000-${String(month).padStart(2, '0')}`, locale);
  const series: ChartLegendItem[] = data.years.map((year, index) => ({ key: String(year), label: String(year), color: colorOf(index), swatch: 'square' }));
  const { legend, shown, opacity } = useChartLegend(t('yoySection'), series);

  return (
    <>
      {legend}
      <ChartFrame>
        <BarChart accessibilityLayer data={data.rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="20%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="month" {...axisProps} axisLine={{ stroke: chartColors.grid }} interval={0} tickFormatter={monthLabel} />
          <YAxis {...axisProps} axisLine={false} width={CHART_Y_AXIS_WIDTH} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <Tooltip
            cursor={{ fill: chartColors.cursor }}
            content={tooltipContent(currency, (month) => capitalizeFirst(monthLabel(Number(month)), locale), series)}
          />
          {data.years.map((year, index) => (
            <Bar key={year} dataKey={year} hide={!shown(String(year))} fill={colorOf(index)} fillOpacity={opacity(String(year))} radius={[3, 3, 0, 0]} maxBarSize={18} />
          ))}
        </BarChart>
      </ChartFrame>
    </>
  );
}

const HEAT_OPACITY = [0, 0.28, 0.5, 0.75, 1] as const;

/** Money in per day as a week-by-weekday calendar; darker cells are stronger days. */
export function CalendarHeatmap({ weeks, side, locale, currency }: {
  weeks: Array<{ start: string; days: HeatmapCell[] }>;
  side: Side;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const color = SIDE_COLOR[side];
  const cellStyle = (cell: HeatmapCell) => (cell.value === null
    ? { backgroundColor: 'transparent' }
    : cell.level === 0
      ? { backgroundColor: chartColors.cursor }
      : { backgroundColor: color, opacity: HEAT_OPACITY[cell.level] });
  const cellTitle = (cell: HeatmapCell) => `${formatDate(cell.date, locale)}: ${cell.value
    ? `${formatCurrency(cell.value)} ${currency}`
    : t('heatmapNoIncome')}`;

  return (
    <div className="mt-4">
      <div className="flex gap-1">
        <div className="grid shrink-0 grid-rows-7 gap-1 pr-1 pt-5 text-xs leading-none text-gray-500" aria-hidden="true">
          {WEEKDAY_KEYS.map((key, index) => (
            <span key={key} className="flex items-center">{index % 2 === 0 ? t(`weekdays.${key}`) : ''}</span>
          ))}
        </div>
        <div className="grid min-w-0 flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
          {weeks.map((week, index) => {
            const month = week.start.slice(0, 7);
            const showMonth = index === 0 || weeks[index - 1].start.slice(0, 7) !== month;
            return (
              <div key={week.start} className="grid min-w-0 grid-rows-[1rem_repeat(7,minmax(0,1fr))] gap-1">
                <span className="whitespace-nowrap text-xs leading-4 text-gray-500" aria-hidden="true">
                  {showMonth ? formatMonthShort(month, locale) : ''}
                </span>
                {week.days.map((cell) => (
                  <span
                    key={cell.date}
                    className="aspect-square w-full max-w-6 rounded-[3px]"
                    style={cellStyle(cell)}
                    title={cell.value === null ? undefined : cellTitle(cell)}
                    role={cell.value === null ? undefined : 'img'}
                    aria-label={cell.value === null ? undefined : cellTitle(cell)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-gray-500" aria-hidden="true">
        {t('heatmapLess')}
        {HEAT_OPACITY.map((opacity, level) => (
          <span
            key={level}
            className="h-3 w-3 rounded-[3px]"
            style={level === 0 ? { backgroundColor: chartColors.cursor } : { backgroundColor: color, opacity }}
          />
        ))}
        {t('heatmapMore')}
      </div>
    </div>
  );
}
