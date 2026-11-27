'use client';

import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslations } from 'next-intl';
import {
  ChartLegendToggle,
  ChartTooltipBody,
  chartColors,
  seriesOpacity,
  seriesTotal,
  useSeriesVisibility,
  type ChartLegendItem,
} from '@/components/dashboard/ChartCard';
import { ChartHeadline } from '@/components/charts/ChartHeadline';
import {
  chartActiveDot,
  chartAnimation,
  chartBar,
  chartBarCursor,
  chartGrid,
  chartLine,
  chartMargin,
  chartTimeAxis,
  chartValueAxis,
  distinctMoneyTick,
  stackTop,
} from '@/components/charts/chartLook';
import { noTooltip, useDayChart } from '@/components/charts/useDayChart';
import { niceAxis, stackedValues } from '@/lib/chartScale';
import { pointsWithin } from '@/lib/chartViewport';
import { formatCurrency, formatDateRange, formatDateShort, formatMonthShort, formatYearMonth } from '@/lib/formatters';
import {
  SPENDING_GROUPS,
  type DailyAnalysisRow,
  type MonthlyAnalysisRow,
  type PlaystationDayRow,
} from '@/lib/calculations/financialAnalysis';
import { AnalysisChartCard, type AnalysisCardProps } from './AnalysisChartCard';
import { SPENDING_GROUP_COLORS } from './analysisFormat';

/** Axis props of the charts not drawn through time (weekdays, calendar months across years). Time charts spread `chartLook`. */
export const axisProps = {
  tick: { fontSize: 11, fill: chartColors.axis },
  tickLine: false,
} as const;

/** The series a legend shows, and the open point's value of each one shown, in legend order. */
export function detailRows<T>(series: readonly ChartLegendItem[], hidden: ReadonlySet<string>, row: T | null | undefined) {
  if (!row) return [];
  return series
    .filter((item) => !hidden.has(item.key))
    .map((item) => {
      const value = (row as Record<string, unknown>)[item.key];
      return { key: item.key, label: item.label, color: item.color, dashed: item.swatch === 'dashed', value: typeof value === 'number' ? value : null };
    });
}

/** Keeps only the keys still shown, so the value axis fits what is drawn. */
export const shownStacks = <K extends string>(stacks: ReadonlyArray<readonly K[]>, hidden: ReadonlySet<string>) =>
  stacks.map((keys) => keys.filter((key) => !hidden.has(key)));

/**
 * Daily money of each side: the game club's and the bar's spending as separate
 * stacks, with each side's money in as its own line. The headline is each
 * side's own money in over the days shown; the sides are never summed.
 */
export function DailyFlowChart({ data, locale, currency, card }: { data: DailyAnalysisRow[]; locale: string; currency: string; card: AnalysisCardProps }) {
  const t = useTranslations('financialAnalysis');
  const names: Record<string, string> = {
    gameClubIncome: t('gameClubIncome'),
    barSales: t('barSales'),
    barCost: t('barCost'),
    gameClubExpenses: t('gameClubExpenses'),
    barExpenses: t('barExpenses'),
  };
  const rows = useMemo(() => data.map((row) => ({ ...row, iso: row.date, label: formatDateShort(row.date, locale) })), [data, locale]);
  const chart = useDayChart(rows);
  const drawn = pointsWithin(chart.points, chart.zoomed);
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const shown = (key: string) => !hidden.has(key);
  // Legend order: the spending stacks, then each side's money in. The tooltip lists them in the same order.
  const series: ChartLegendItem[] = [
    ...SPENDING_GROUPS.map((group) => ({ key: group as string, label: names[group], color: SPENDING_GROUP_COLORS[group], swatch: 'square' as const })),
    { key: 'gameClubIncome', label: names.gameClubIncome, color: chartColors.primary, swatch: 'line' },
    { key: 'barSales', label: names.barSales, color: chartColors.orange, swatch: 'line' },
  ];
  const keys = series.map((item) => item.key);
  const axis = niceAxis([
    0,
    ...stackedValues(drawn, shownStacks([['gameClubExpenses'], ['barCost', 'barExpenses'], ['gameClubIncome'], ['barSales']] as const, hidden)),
  ]);
  const animation = chartAnimation(chart.reducedMotion || chart.filling);
  const dots = drawn.length <= 14 ? { r: 2.5 } : false;

  const headline = (
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      {(['gameClubIncome', 'barSales'] as const).filter(shown).map((key) => (
        <ChartHeadline key={key} label={names[key]} figure={formatCurrency(seriesTotal(drawn, (row) => row[key]))} unit={currency} locale={locale} />
      ))}
    </div>
  );
  const first = drawn[0];
  const last = drawn[drawn.length - 1];

  return (
    <AnalysisChartCard
      card={card}
      chart={chart}
      headline={headline}
      heightClassName="h-72"
      range={first && last ? formatDateRange(first.iso, last.iso, locale) : null}
      details={detailRows(series, hidden, chart.openRow)}
      currency={currency}
      legend={<ChartLegendToggle label={t('dailyTitle')} items={series} hidden={hidden} onToggle={(key) => toggle(key, keys)} onFocus={setFocused} />}
    >
      <ComposedChart accessibilityLayer data={drawn} margin={chartMargin} barGap={2} barCategoryGap="20%" onClick={chart.dayClick(drawn)}>
        <CartesianGrid {...chartGrid} />
        <XAxis dataKey="label" {...chartTimeAxis} />
        <YAxis {...chartValueAxis} domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={distinctMoneyTick(axis.ticks, locale)} />
        <Tooltip
          cursor={chartBarCursor}
          content={chart.mobile ? noTooltip : ({ active, label, payload }) => (
            <ChartTooltipBody active={active} label={label} payload={payload} series={series} currency={currency} />
          )}
        />
        <Bar
          dataKey="gameClubExpenses"
          stackId="gameClub"
          hide={!shown('gameClubExpenses')}
          fill={SPENDING_GROUP_COLORS.gameClubExpenses}
          fillOpacity={0.85 * seriesOpacity('gameClubExpenses', focused)}
          {...chartBar}
          maxBarSize={18}
          {...animation}
        />
        <Bar
          dataKey="barCost"
          stackId="bar"
          hide={!shown('barCost')}
          fill={SPENDING_GROUP_COLORS.barCost}
          fillOpacity={0.85 * seriesOpacity('barCost', focused)}
          {...chartBar}
          {...stackTop(!shown('barExpenses'))}
          maxBarSize={18}
          {...animation}
        />
        <Bar
          dataKey="barExpenses"
          stackId="bar"
          hide={!shown('barExpenses')}
          fill={SPENDING_GROUP_COLORS.barExpenses}
          fillOpacity={0.85 * seriesOpacity('barExpenses', focused)}
          {...chartBar}
          maxBarSize={18}
          {...animation}
        />
        <Line dataKey="gameClubIncome" hide={!shown('gameClubIncome')} stroke={chartColors.primary} strokeOpacity={seriesOpacity('gameClubIncome', focused)} {...chartLine} dot={dots} activeDot={chartActiveDot(chartColors.primary)} />
        <Line dataKey="barSales" hide={!shown('barSales')} stroke={chartColors.orange} strokeOpacity={seriesOpacity('barSales', focused)} {...chartLine} dot={dots} activeDot={chartActiveDot(chartColors.orange)} />
      </ComposedChart>
    </AnalysisChartCard>
  );
}

/**
 * Each side's money in per month as bars, with what that side had left as a
 * line. The headline is each side's own money in over the months shown.
 */
export function MonthlyTrendChart({ data, locale, currency, card }: { data: MonthlyAnalysisRow[]; locale: string; currency: string; card: AnalysisCardProps }) {
  const t = useTranslations('financialAnalysis');
  const names: Record<string, string> = {
    gameClubIncome: t('gameClubIncome'),
    gameClubLeft: t('drill.gameClubLeft'),
    barSales: t('barSales'),
    barLeft: t('drill.barLeft'),
  };
  const monthTitle = (month: string) => formatYearMonth(month.slice(0, 7), locale);
  const rows = useMemo(() => data.map((row) => ({ ...row, iso: `${row.month.slice(0, 7)}-01` })), [data]);
  const chart = useDayChart(rows, undefined, { evenlySpaced: true });
  const drawn = pointsWithin(chart.points, chart.zoomed);
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const shown = (key: string) => !hidden.has(key);
  const series: ChartLegendItem[] = [
    { key: 'gameClubIncome', label: names.gameClubIncome, color: chartColors.primary, swatch: 'square' },
    { key: 'gameClubLeft', label: names.gameClubLeft, color: chartColors.success, swatch: 'line' },
    { key: 'barSales', label: names.barSales, color: chartColors.orange, swatch: 'square' },
    { key: 'barLeft', label: names.barLeft, color: chartColors.purple, swatch: 'line' },
  ];
  const keys = series.map((item) => item.key);
  // The tooltip and the details list the bars, then the lines, as they are drawn.
  const drawingOrder = [series[0], series[2], series[1], series[3]];
  const axis = niceAxis([0, ...stackedValues(drawn, shownStacks([['gameClubIncome'], ['barSales'], ['gameClubLeft'], ['barLeft']] as const, hidden))]);
  const animation = chartAnimation(chart.reducedMotion || chart.filling);
  const dots = drawn.length <= 24 ? { r: 3 } : false;

  const headline = (
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      {(['gameClubIncome', 'barSales'] as const).filter(shown).map((key) => (
        <ChartHeadline key={key} label={names[key]} figure={formatCurrency(seriesTotal(drawn, (row) => row[key]))} unit={currency} locale={locale} />
      ))}
    </div>
  );
  const first = drawn[0];
  const last = drawn[drawn.length - 1];
  const open = chart.openRow;

  return (
    <AnalysisChartCard
      card={card}
      chart={chart}
      headline={headline}
      heightClassName="h-72"
      range={first && last ? `${monthTitle(first.month)} – ${monthTitle(last.month)}` : null}
      details={detailRows(drawingOrder, hidden, open)}
      detailsLabel={open ? monthTitle(open.month) : undefined}
      currency={currency}
      legend={<ChartLegendToggle label={t('monthlyTitle')} items={series} hidden={hidden} onToggle={(key) => toggle(key, keys)} onFocus={setFocused} />}
    >
      <ComposedChart accessibilityLayer data={drawn} margin={chartMargin} barGap={2} barCategoryGap="22%" onClick={chart.dayClick(drawn)}>
        <CartesianGrid {...chartGrid} />
        <XAxis
          dataKey="month"
          {...chartTimeAxis}
          interval={drawn.length > 12 ? 'preserveStartEnd' : 0}
          tickFormatter={(month: string) => formatMonthShort(month, locale)}
        />
        <YAxis {...chartValueAxis} domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={distinctMoneyTick(axis.ticks, locale)} />
        <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
        <Tooltip
          cursor={chartBarCursor}
          content={chart.mobile ? noTooltip : ({ active, label, payload }) => (
            <ChartTooltipBody active={active} label={monthTitle(String(label))} payload={payload} series={drawingOrder} currency={currency} />
          )}
        />
        <Bar dataKey="gameClubIncome" hide={!shown('gameClubIncome')} fill={chartColors.primary} fillOpacity={seriesOpacity('gameClubIncome', focused)} {...chartBar} maxBarSize={20} {...animation} />
        <Bar dataKey="barSales" hide={!shown('barSales')} fill={chartColors.orange} fillOpacity={seriesOpacity('barSales', focused)} {...chartBar} maxBarSize={20} {...animation} />
        <Line dataKey="gameClubLeft" hide={!shown('gameClubLeft')} stroke={chartColors.success} strokeOpacity={seriesOpacity('gameClubLeft', focused)} {...chartLine} strokeWidth={2.5} dot={dots} activeDot={chartActiveDot(chartColors.success)} />
        <Line dataKey="barLeft" hide={!shown('barLeft')} stroke={chartColors.purple} strokeOpacity={seriesOpacity('barLeft', focused)} {...chartLine} strokeWidth={2.5} dot={dots} activeDot={chartActiveDot(chartColors.purple)} />
      </ComposedChart>
    </AnalysisChartCard>
  );
}

/**
 * PlayStation money each day as bars, with the period's running total as a
 * line on its own axis. The card's own figures stand above it (`card.children`).
 */
export function PlaystationDailyChart({ data, locale, currency, card }: { data: PlaystationDayRow[]; locale: string; currency: string; card: AnalysisCardProps }) {
  const t = useTranslations('financialAnalysis');
  const names: Record<string, string> = { amount: t('playstationDay'), running: t('playstationRunning') };
  const rows = useMemo(() => data.map((row) => ({ ...row, iso: row.date, label: formatDateShort(row.date, locale) })), [data, locale]);
  const chart = useDayChart(rows);
  const drawn = pointsWithin(chart.points, chart.zoomed);
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const series: ChartLegendItem[] = [
    { key: 'amount', label: names.amount, color: chartColors.purple, swatch: 'square' },
    { key: 'running', label: names.running, color: chartColors.primary, swatch: 'line' },
  ];
  const keys = series.map((item) => item.key);
  const dayAxis = niceAxis([0, ...drawn.map((row) => row.amount)]);
  const runningAxis = niceAxis([0, ...drawn.map((row) => row.running)]);
  const first = drawn[0];
  const last = drawn[drawn.length - 1];

  return (
    <AnalysisChartCard
      card={card}
      chart={chart}
      range={first && last ? formatDateRange(first.iso, last.iso, locale) : null}
      details={detailRows(series, hidden, chart.openRow)}
      currency={currency}
      legend={<ChartLegendToggle label={t('playstationTitle')} items={series} hidden={hidden} onToggle={(key) => toggle(key, keys)} onFocus={setFocused} />}
    >
      <ComposedChart accessibilityLayer data={drawn} margin={chartMargin} barCategoryGap="20%" onClick={chart.dayClick(drawn)}>
        <CartesianGrid {...chartGrid} />
        <XAxis dataKey="label" {...chartTimeAxis} />
        <YAxis yAxisId="day" {...chartValueAxis} domain={dayAxis.domain} ticks={dayAxis.ticks} allowDataOverflow tickFormatter={distinctMoneyTick(dayAxis.ticks, locale)} />
        <YAxis
          yAxisId="running"
          orientation="right"
          {...chartValueAxis}
          domain={runningAxis.domain}
          ticks={runningAxis.ticks}
          allowDataOverflow
          tickFormatter={distinctMoneyTick(runningAxis.ticks, locale)}
        />
        <Tooltip
          cursor={chartBarCursor}
          content={chart.mobile ? noTooltip : ({ active, label, payload }) => (
            <ChartTooltipBody active={active} label={label} payload={payload} series={series} currency={currency} />
          )}
        />
        <Bar
          yAxisId="day"
          dataKey="amount"
          hide={hidden.has('amount')}
          fill={chartColors.purple}
          fillOpacity={0.85 * seriesOpacity('amount', focused)}
          {...chartBar}
          maxBarSize={18}
          {...chartAnimation(chart.reducedMotion || chart.filling)}
        />
        <Line
          yAxisId="running"
          dataKey="running"
          hide={hidden.has('running')}
          stroke={chartColors.primary}
          strokeOpacity={seriesOpacity('running', focused)}
          {...chartLine}
          strokeWidth={2.5}
          activeDot={chartActiveDot(chartColors.primary)}
        />
      </ComposedChart>
    </AnalysisChartCard>
  );
}
