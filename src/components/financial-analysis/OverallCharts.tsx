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
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReactElement, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { chartColors, chartTooltipStyle, formatAxis } from '@/components/dashboard/ChartCard';
import {
  capitalizeFirst,
  formatCurrency,
  formatDate,
  formatDateShort,
  formatMonthShort,
  formatYearMonth,
} from '@/lib/formatters';
import type {
  Granularity,
  OwnerMonthRow,
  PeriodSeriesRow,
  ProfitMonthRow,
  WeekdayPatternRow,
} from '@/lib/calculations/analysisSeries';
import { OTHER_CATEGORY, type CategoryAmount } from '@/lib/calculations/financialAnalysis';
import { axisProps, LegendItem } from './AnalysisTimeCharts';
import { formatShare, SOURCE_COLORS } from './analysisFormat';

type Side = 'gameClub' | 'bar';

const SIDE_COLOR: Record<Side, string> = { gameClub: chartColors.primary, bar: chartColors.orange };

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

function Legend({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-gray-500">{children}</div>;
}

function ChartFrame({ children }: { children: ReactElement }) {
  return (
    <div className="mt-3 h-64">
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

const moneyFormatter = (currency: string, names: Record<string, string>) => (
  (value: unknown, name: unknown) => [`${formatCurrency(Number(value))} ${currency}`, names[String(name)] ?? String(name)] as [string, string]
);

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
  const names: Record<string, string> = { [income]: t(side === 'gameClub' ? 'moneyIn' : 'barSalesIn'), [spent]: t('spent'), [left]: t('profit') };
  const labels = periodLabels(granularity, locale);
  const ends = new Map(rows.map((row) => [row.period, row.end]));

  return (
    <>
      <Legend>
        <LegendItem color={SIDE_COLOR[side]} label={names[income]} />
        <LegendItem color={chartColors.danger} label={names[spent]} />
        <LegendItem color={chartColors.success} label={names[left]} line />
      </Legend>
      <ChartFrame>
        <ComposedChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="period" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={12} tickFormatter={labels.tick} />
          <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
          <Tooltip
            {...chartTooltipStyle}
            cursor={{ fill: chartColors.cursor }}
            labelFormatter={(period) => labels.title(String(period), ends.get(String(period)))}
            formatter={moneyFormatter(currency, names)}
          />
          <Bar dataKey={income} fill={SIDE_COLOR[side]} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Bar dataKey={spent} fill={chartColors.danger} fillOpacity={0.8} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Line dataKey={left} type="monotone" stroke={chartColors.success} strokeWidth={2.5} dot={rows.length <= 31 ? { r: 2.5 } : false} />
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
  const names: Record<string, string> = { gameClubCumulative: t('drill.gameClubLeft'), barCumulative: t('drill.barLeft') };
  const labels = periodLabels(granularity, locale);
  const ends = new Map(rows.map((row) => [row.period, row.end]));

  return (
    <>
      <Legend>
        <LegendItem color={chartColors.primary} label={names.gameClubCumulative} />
        <LegendItem color={chartColors.orange} label={names.barCumulative} />
      </Legend>
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
          <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
          <Tooltip
            {...chartTooltipStyle}
            labelFormatter={(period) => labels.title(String(period), ends.get(String(period)))}
            formatter={moneyFormatter(currency, names)}
          />
          <Area dataKey="gameClubCumulative" type="monotone" stroke={chartColors.primary} strokeWidth={2} fill="url(#cumulative-gameClub)" />
          <Area dataKey="barCumulative" type="monotone" stroke={chartColors.orange} strokeWidth={2} fill="url(#cumulative-bar)" />
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
  const names: Record<string, string> = Object.fromEntries(keys.map((key) => [key, t(`sources.${key}`)]));
  const labels = periodLabels(granularity, locale);
  const ends = new Map(rows.map((row) => [row.period, row.end]));

  return (
    <>
      <Legend>
        {keys.map((key) => <LegendItem key={key} color={SOURCE_COLORS[key]} label={names[key]} />)}
      </Legend>
      <ChartFrame>
        <BarChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="period" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={12} tickFormatter={labels.tick} />
          <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <Tooltip
            {...chartTooltipStyle}
            cursor={{ fill: chartColors.cursor }}
            labelFormatter={(period) => labels.title(String(period), ends.get(String(period)))}
            formatter={moneyFormatter(currency, names)}
          />
          {keys.map((key, index) => (
            <Bar key={key} dataKey={key} stackId="income" fill={SOURCE_COLORS[key]} maxBarSize={28} radius={index === keys.length - 1 ? [3, 3, 0, 0] : undefined} />
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
  const keys = categories.map((row) => row.category);
  const names: Record<string, string> = Object.fromEntries(keys.map((key) => [key, labelFor(key)]));
  const labels = periodLabels(granularity, locale);
  const colorOf = (key: string) => colors[key] ?? colors[OTHER_CATEGORY];

  return (
    <>
      <Legend>
        {keys.map((key) => <LegendItem key={key} color={colorOf(key)} label={names[key]} />)}
      </Legend>
      <ChartFrame>
        <BarChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="period" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={12} tickFormatter={labels.tick} />
          <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <Tooltip
            {...chartTooltipStyle}
            cursor={{ fill: chartColors.cursor }}
            labelFormatter={(period) => labels.title(String(period))}
            formatter={moneyFormatter(currency, names)}
          />
          {keys.map((key, index) => (
            <Bar key={key} dataKey={key} stackId="expenses" fill={colorOf(key)} maxBarSize={28} radius={index === keys.length - 1 ? [3, 3, 0, 0] : undefined} />
          ))}
        </BarChart>
      </ChartFrame>
    </>
  );
}

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Average money in per weekday, each side as its own bar. */
export function WeekdayChart({ rows, locale, currency }: { rows: WeekdayPatternRow[]; locale: string; currency: string }) {
  const t = useTranslations('financialAnalysis');
  const names: Record<string, string> = { gameClubAverage: t('gameClubIncome'), barAverage: t('barSales') };
  const data = rows.map((row) => ({ ...row, label: t(`weekdays.${WEEKDAY_KEYS[row.weekday]}`) }));

  return (
    <>
      <Legend>
        <LegendItem color={chartColors.primary} label={names.gameClubAverage} />
        <LegendItem color={chartColors.orange} label={names.barAverage} />
      </Legend>
      <ChartFrame>
        <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={3} barCategoryGap="24%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} axisLine={{ stroke: chartColors.grid }} interval={0} />
          <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <Tooltip {...chartTooltipStyle} cursor={{ fill: chartColors.cursor }} formatter={moneyFormatter(currency, names)} />
          <Bar dataKey="gameClubAverage" fill={chartColors.primary} radius={[3, 3, 0, 0]} maxBarSize={32} />
          <Bar dataKey="barAverage" fill={chartColors.orange} radius={[3, 3, 0, 0]} maxBarSize={32} />
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
  const names: Record<string, string> = { profit: t('profit'), marginPct: t('margin') };
  const monthTitle = (month: string) => capitalizeFirst(formatYearMonth(month.slice(0, 7), locale), locale);

  return (
    <>
      <Legend>
        <LegendItem color={chartColors.success} label={t('profit')} />
        <LegendItem color={chartColors.danger} label={t('loss')} />
        <LegendItem color={chartColors.axis} label={t('average')} line />
        <LegendItem color={chartColors.purple} label={t('margin')} line />
      </Legend>
      <ChartFrame>
        <ComposedChart accessibilityLayer data={rows} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis
            dataKey="month"
            {...axisProps}
            axisLine={{ stroke: chartColors.grid }}
            interval={rows.length > 12 ? 'preserveStartEnd' : 0}
            tickFormatter={(month: string) => formatMonthShort(month, locale)}
          />
          <YAxis yAxisId="money" {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <YAxis yAxisId="pct" orientation="right" {...axisProps} axisLine={false} width={36} tickFormatter={(value: number) => `${value}%`} />
          <ReferenceLine yAxisId="money" y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
          <ReferenceLine yAxisId="money" y={average} stroke={chartColors.axis} strokeDasharray="5 4" />
          <Tooltip
            {...chartTooltipStyle}
            cursor={{ fill: chartColors.cursor }}
            labelFormatter={(month) => monthTitle(String(month))}
            formatter={(value, name) => (name === 'marginPct'
              ? [formatShare(value === null ? null : Number(value), locale), names.marginPct]
              : [`${formatCurrency(Number(value))} ${currency}`, names.profit])}
          />
          <Bar yAxisId="money" dataKey="profit" radius={[3, 3, 0, 0]} maxBarSize={36}>
            {rows.map((row) => <Cell key={row.month} fill={row.profit < 0 ? chartColors.danger : chartColors.success} />)}
          </Bar>
          <Line yAxisId="pct" dataKey="marginPct" type="monotone" stroke={chartColors.purple} strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </ComposedChart>
      </ChartFrame>
    </>
  );
}

/** Owner money per month: each side's withdrawals stacked under what is still left to take. */
export function OwnerMonthsChart({ rows, locale, currency }: { rows: OwnerMonthRow[]; locale: string; currency: string }) {
  const t = useTranslations('financialAnalysis');
  const names: Record<string, string> = {
    gameClubWithdrawn: t('tableGameClubWithdrawn'),
    gameClubLeft: t('gameClubLeftToTake'),
    barWithdrawn: t('tableBarWithdrawn'),
    barLeft: t('barLeftToTake'),
  };
  const monthTitle = (month: string) => capitalizeFirst(formatYearMonth(month.slice(0, 7), locale), locale);

  return (
    <>
      <Legend>
        <LegendItem color={chartColors.primary} label={names.gameClubWithdrawn} />
        <LegendItem color={chartColors.success} label={names.gameClubLeft} />
        <LegendItem color={chartColors.orange} label={names.barWithdrawn} />
        <LegendItem color={chartColors.purple} label={names.barLeft} />
      </Legend>
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
          <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
          <Tooltip
            {...chartTooltipStyle}
            cursor={{ fill: chartColors.cursor }}
            labelFormatter={(month) => monthTitle(String(month))}
            formatter={moneyFormatter(currency, names)}
          />
          <Bar dataKey="gameClubWithdrawn" stackId="gameClub" fill={chartColors.primary} maxBarSize={30} />
          <Bar dataKey="gameClubLeft" stackId="gameClub" fill={chartColors.success} maxBarSize={30} radius={[3, 3, 0, 0]} />
          <Bar dataKey="barWithdrawn" stackId="bar" fill={chartColors.orange} maxBarSize={30} />
          <Bar dataKey="barLeft" stackId="bar" fill={chartColors.purple} maxBarSize={30} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartFrame>
    </>
  );
}
