'use client';

import { useId, useMemo } from 'react';
import {
  Area,
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
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  CHART_Y_AXIS_WIDTH,
  ChartLegendToggle,
  ChartTooltipBody,
  chartColors,
  formatAxis,
  seriesOpacity,
  seriesTotal,
  useSeriesVisibility,
  type ChartLegendItem,
} from '@/components/dashboard/ChartCard';
import { ChartHeadline } from '@/components/charts/ChartHeadline';
import { ChartGradient, EndLabelTick, endLabelWidth, endLabelsFor } from '@/components/charts/EndLabels';
import {
  averageLine,
  chartActiveDot,
  chartAnimation,
  chartBar,
  chartBarCursor,
  chartEndAxis,
  chartGrid,
  chartLine,
  chartLineCursor,
  chartMargin,
  chartTimeAxis,
  chartValueAxis,
  distinctMoneyTick,
  endLabelMoney,
  leadArea,
  plannedLine,
  stackTop,
} from '@/components/charts/chartLook';
import { DAY_MS, noTooltip, useDayChart } from '@/components/charts/useDayChart';
import { changePercent, seriesEnds, type HeadlineChange } from '@/lib/calculations/chartHeadline';
import { evenTimeTicks, niceAxis, stackedValues } from '@/lib/chartScale';
import { pointsInView, pointsWithin, type Viewport } from '@/lib/chartViewport';
import {
  capitalizeFirst,
  formatCurrency,
  formatDate,
  formatDateRange,
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
import { AnalysisChartCard, type AnalysisCardProps } from './AnalysisChartCard';
import { axisProps, detailRows, shownStacks } from './AnalysisTimeCharts';
import { formatShare, SOURCE_COLORS } from './analysisFormat';

type Side = 'gameClub' | 'bar';

const SIDE_COLOR: Record<ForecastSide, string> = { gameClub: chartColors.primary, bar: chartColors.orange, playstation: chartColors.purple };

/** Axis tick and tooltip title of a bucket: its day, its week's first day or its month. */
function periodLabels(granularity: Granularity, locale: string) {
  const title = (period: string, end?: string) => {
    if (granularity === 'day') return formatDate(period, locale);
    if (granularity === 'month') return capitalizeFirst(formatYearMonth(period.slice(0, 7), locale), locale);
    return `${formatDateShort(period, locale)} – ${formatDateShort(end ?? period, locale)}`;
  };
  return {
    tick: (period: string) => (granularity === 'month' ? formatMonthShort(period, locale) : formatDateShort(period, locale)),
    title,
    /** What a zoomed-in chart shows, from its first bucket to its last. */
    range: (first: { period: string; end?: string } | undefined, last: { period: string; end?: string } | undefined) => {
      if (!first || !last) return null;
      if (granularity === 'month') return first.period === last.period ? title(first.period) : `${title(first.period)} – ${title(last.period)}`;
      return formatDateRange(first.period, last.end ?? last.period, locale);
    },
  };
}

/** A month's title ("November 2026") and the range of months a zoomed-in chart shows. */
function monthLabels(locale: string) {
  const title = (month: string) => capitalizeFirst(formatYearMonth(month.slice(0, 7), locale), locale);
  return {
    title,
    range: (first: { month: string } | undefined, last: { month: string } | undefined) => (first && last
      ? first.month === last.month ? title(first.month) : `${title(first.month)} – ${title(last.month)}`
      : null),
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
    hidden,
    shown: (key: string) => !hidden.has(key),
    opacity: (key: string, base = 1) => base * seriesOpacity(key, focused),
    legend: <ChartLegendToggle label={label} items={items} hidden={hidden} onToggle={(key) => toggle(key, keys)} onFocus={setFocused} />,
  };
}

/** The plot's height in the card (h-64), less the time axis, for spacing the end labels. */
const plotHeight = (boxHeight: number | undefined) => (boxHeight ?? 256) - 38;

/**
 * A line chart's time axis over evenly spaced buckets (`useDayChart`'s
 * `evenlySpaced`): the stretch in view and round-step ticks, each naming the
 * bucket at that step.
 */
function stepAxis(points: ReadonlyArray<{ timestamp: number }>, zoomed: Viewport | null, count: number) {
  const last = points[points.length - 1]?.timestamp ?? 0;
  const domain: [number, number] = zoomed ? [zoomed.start, zoomed.end] : [0, Math.max(last, DAY_MS)];
  return { domain, ticks: evenTimeTicks(domain[0], domain[1], count), index: (timestamp: unknown) => Math.round(Number(timestamp) / DAY_MS) };
}

/** A running series' change over the buckets in view: the profit those buckets added, against where the series stood before them. */
function runningChange(latest: number | undefined, added: number): HeadlineChange | null {
  return latest === undefined ? null : { amount: added, percent: changePercent(latest, added) };
}

/** One side per chart: money in and spending as bars, profit as a line; the headline is that side's profit over the buckets shown. */
export function SideFlowChart({ rows, side, granularity, locale, currency, card }: {
  rows: PeriodSeriesRow[];
  side: Side;
  granularity: Granularity;
  locale: string;
  currency: string;
  card: AnalysisCardProps;
}) {
  const t = useTranslations('financialAnalysis');
  const income = side === 'gameClub' ? 'gameClubIncome' : 'barSales';
  const spent = side === 'gameClub' ? 'gameClubSpent' : 'barSpent';
  const left = side === 'gameClub' ? 'gameClubLeft' : 'barLeft';
  const labels = periodLabels(granularity, locale);
  const points = useMemo(() => rows.map((row) => ({ ...row, iso: row.period })), [rows]);
  const chart = useDayChart(points, undefined, { evenlySpaced: true });
  const drawn = pointsWithin(chart.points, chart.zoomed);
  const ends = new Map(rows.map((row) => [row.period, row.end]));
  const series: ChartLegendItem[] = [
    { key: income, label: t(side === 'gameClub' ? 'moneyIn' : 'barSalesIn'), color: SIDE_COLOR[side], swatch: 'square' },
    { key: spent, label: t('spent'), color: chartColors.danger, swatch: 'square' },
    { key: left, label: t('profit'), color: chartColors.success, swatch: 'line' },
  ];
  const { legend, shown, opacity, hidden } = useChartLegend(t(side === 'gameClub' ? 'sideFlowGameClubTitle' : 'sideFlowBarTitle'), series);
  const axis = niceAxis([0, ...stackedValues(drawn, shownStacks([[income], [spent], [left]] as const, hidden))]);
  const animation = chartAnimation(chart.reducedMotion || chart.filling);
  const open = chart.openRow;

  return (
    <AnalysisChartCard
      card={card}
      chart={chart}
      legend={legend}
      headline={<ChartHeadline label={t('profit')} figure={formatCurrency(seriesTotal(drawn, (row) => row[left]))} unit={currency} locale={locale} />}
      range={labels.range(drawn[0], drawn[drawn.length - 1])}
      details={detailRows(series, hidden, open)}
      detailsLabel={open ? labels.title(open.period, open.end) : undefined}
      currency={currency}
    >
      <ComposedChart accessibilityLayer data={drawn} margin={chartMargin} barGap={2} barCategoryGap="22%" onClick={chart.dayClick(drawn)}>
        <CartesianGrid {...chartGrid} />
        <XAxis dataKey="period" {...chartTimeAxis} tickFormatter={labels.tick} />
        <YAxis {...chartValueAxis} domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={distinctMoneyTick(axis.ticks, locale)} />
        <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
        <Tooltip
          cursor={chartBarCursor}
          content={chart.mobile ? noTooltip : tooltipContent(currency, (period) => labels.title(String(period), ends.get(String(period))), series)}
        />
        <Bar dataKey={income} hide={!shown(income)} fill={SIDE_COLOR[side]} fillOpacity={opacity(income)} {...chartBar} maxBarSize={22} {...animation} />
        <Bar dataKey={spent} hide={!shown(spent)} fill={chartColors.danger} fillOpacity={opacity(spent, 0.8)} {...chartBar} maxBarSize={22} {...animation} />
        <Line dataKey={left} hide={!shown(left)} stroke={chartColors.success} strokeOpacity={opacity(left)} {...chartLine} strokeWidth={2.5} dot={drawn.length <= 31 ? { r: 2.5 } : false} activeDot={chartActiveDot(chartColors.success)} />
      </ComposedChart>
    </AnalysisChartCard>
  );
}

/**
 * Each side's running profit across the drawn buckets: the game club leads as
 * an area, the bar is a line beside it. The headline is each side's latest
 * running profit in view (never summed), and once zoomed in, the profit the
 * buckets in view added; each line's latest value sits at its right end.
 */
export function CumulativeProfitChart({ rows, granularity, locale, currency, card }: {
  rows: PeriodSeriesRow[];
  granularity: Granularity;
  locale: string;
  currency: string;
  card: AnalysisCardProps;
}) {
  const t = useTranslations('financialAnalysis');
  const gradientId = useId().replace(/:/g, '');
  const labels = periodLabels(granularity, locale);
  const points = useMemo(() => rows.map((row) => ({ ...row, iso: row.period })), [rows]);
  // Every bucket takes one step, days included, so the line's x is the bucket's index.
  const chart = useDayChart(points, undefined, { evenlySpaced: true });
  const { zoomed, mobile } = chart;
  const sides = [
    { key: 'gameClubCumulative', left: 'gameClubLeft', label: t('drill.gameClubLeft'), color: chartColors.primary },
    { key: 'barCumulative', left: 'barLeft', label: t('drill.barLeft'), color: chartColors.orange },
  ] as const;
  const series: ChartLegendItem[] = sides.map((side, index) => ({ key: side.key, label: side.label, color: side.color, swatch: index === 0 ? 'square' : 'line' }));
  const { legend, shown, opacity, hidden } = useChartLegend(t('cumulativeTitle'), series);

  // Zoomed in, the lines run out to both edges through the buckets just outside; figures count only the buckets inside.
  const drawn = zoomed ? pointsInView(chart.points, zoomed) : chart.points;
  const within = pointsWithin(chart.points, zoomed);
  const shownSides = sides.filter((side) => shown(side.key));
  const axis = niceAxis([0, ...drawn.flatMap((row) => shownSides.map((side) => row[side.key]))]);
  const latest = (side: (typeof sides)[number]) => seriesEnds(within.map((row) => row[side.key]))?.last;
  const endLabels = endLabelsFor(
    shownSides.map((side) => ({ value: latest(side), color: side.color })),
    axis.domain,
    plotHeight(chart.chartHeight),
    endLabelMoney(locale),
  );
  const time = stepAxis(chart.points, zoomed, mobile ? 4 : 6);
  const bucketAt = (timestamp: unknown) => chart.points[time.index(timestamp)];
  const open = chart.openRow;

  const headline = (
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      {shownSides.map((side) => {
        const last = latest(side);
        return (
          <ChartHeadline
            key={side.key}
            label={side.label}
            figure={formatCurrency(last ?? 0)}
            unit={currency}
            // Over every bucket the change would only repeat the figure; zoomed in, it is what the buckets in view added.
            change={zoomed ? runningChange(last, seriesTotal(within, (row) => row[side.left])) : null}
            locale={locale}
          />
        );
      })}
    </div>
  );

  return (
    <AnalysisChartCard
      card={card}
      chart={chart}
      legend={legend}
      headline={headline}
      range={labels.range(within[0], within[within.length - 1])}
      details={detailRows(series, hidden, open)}
      detailsLabel={open ? labels.title(open.period, open.end) : undefined}
      currency={currency}
    >
      <ComposedChart accessibilityLayer data={drawn} margin={chartMargin} onClick={chart.dayClick(drawn)}>
        <ChartGradient id={gradientId} color={chartColors.primary} />
        <CartesianGrid {...chartGrid} />
        <XAxis
          {...chartTimeAxis}
          dataKey="timestamp"
          type="number"
          domain={time.domain}
          allowDataOverflow={!!zoomed}
          ticks={time.ticks}
          interval="preserveStartEnd"
          minTickGap={24}
          tickFormatter={(timestamp: number) => {
            const bucket = bucketAt(timestamp);
            return bucket ? labels.tick(bucket.period) : '';
          }}
        />
        <YAxis {...chartValueAxis} domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={distinctMoneyTick(axis.ticks, locale)} />
        {endLabels.length > 0 && (
          <YAxis
            yAxisId="ends"
            {...chartEndAxis}
            domain={axis.domain}
            ticks={endLabels.map((item) => item.at)}
            width={endLabelWidth(endLabels)}
            tick={<EndLabelTick labels={endLabels} />}
          />
        )}
        <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
        <Tooltip
          cursor={chartLineCursor}
          content={mobile ? noTooltip : tooltipContent(currency, (timestamp) => {
            const bucket = bucketAt(timestamp);
            return bucket ? labels.title(bucket.period, bucket.end) : '';
          }, series)}
        />
        <Area
          dataKey="gameClubCumulative"
          hide={!shown('gameClubCumulative')}
          {...leadArea(gradientId, chartColors.primary)}
          strokeOpacity={opacity('gameClubCumulative')}
          fillOpacity={opacity('gameClubCumulative')}
          {...chartAnimation(chart.reducedMotion || chart.filling)}
        />
        <Line
          dataKey="barCumulative"
          hide={!shown('barCumulative')}
          stroke={chartColors.orange}
          strokeOpacity={opacity('barCumulative')}
          {...chartLine}
          activeDot={chartActiveDot(chartColors.orange)}
        />
      </ComposedChart>
    </AnalysisChartCard>
  );
}

/** Game club money in per bucket, stacked by source; the headline is the game club's money in over the buckets shown. */
export function IncomeMixChart({ rows, granularity, locale, currency, card }: {
  rows: PeriodSeriesRow[];
  granularity: Granularity;
  locale: string;
  currency: string;
  card: AnalysisCardProps;
}) {
  const t = useTranslations('financialAnalysis');
  const keys = ['computers', 'playstation', 'debts'] as const;
  const labels = periodLabels(granularity, locale);
  const points = useMemo(() => rows.map((row) => ({ ...row, iso: row.period })), [rows]);
  const chart = useDayChart(points, undefined, { evenlySpaced: true });
  const drawn = pointsWithin(chart.points, chart.zoomed);
  const ends = new Map(rows.map((row) => [row.period, row.end]));
  const series: ChartLegendItem[] = keys.map((key) => ({ key, label: t(`sources.${key}`), color: SOURCE_COLORS[key], swatch: 'square' }));
  const { legend, shown, opacity, hidden } = useChartLegend(t('incomeMixTitle'), series);
  const [stack] = shownStacks([keys], hidden);
  const axis = niceAxis([0, ...stackedValues(drawn, [stack])]);
  const open = chart.openRow;

  return (
    <AnalysisChartCard
      card={card}
      chart={chart}
      legend={legend}
      headline={<ChartHeadline label={t('gameClubIncome')} figure={formatCurrency(seriesTotal(drawn, (row) => row.gameClubIncome))} unit={currency} locale={locale} />}
      range={labels.range(drawn[0], drawn[drawn.length - 1])}
      details={detailRows(series, hidden, open)}
      detailsLabel={open ? labels.title(open.period, open.end) : undefined}
      currency={currency}
    >
      <BarChart accessibilityLayer data={drawn} margin={chartMargin} barCategoryGap="22%" onClick={chart.dayClick(drawn)}>
        <CartesianGrid {...chartGrid} />
        <XAxis dataKey="period" {...chartTimeAxis} tickFormatter={labels.tick} />
        <YAxis {...chartValueAxis} domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={distinctMoneyTick(axis.ticks, locale)} />
        <Tooltip
          cursor={chartBarCursor}
          content={chart.mobile ? noTooltip : tooltipContent(currency, (period) => labels.title(String(period), ends.get(String(period))), series)}
        />
        {keys.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            hide={!shown(key)}
            stackId="income"
            fill={SOURCE_COLORS[key]}
            fillOpacity={opacity(key)}
            {...chartBar}
            {...stackTop(key === stack[stack.length - 1])}
            {...chartAnimation(chart.reducedMotion || chart.filling)}
          />
        ))}
      </BarChart>
    </AnalysisChartCard>
  );
}

/**
 * Operating expenses per bucket, stacked by category in the shared category
 * colours. `periods` are the same buckets' money rows, which carry each
 * bucket's last day (a week cut at the range's end).
 */
export function CategoryTrendChart({ rows, periods, categories, colors, labelFor, granularity, locale, currency, card }: {
  rows: Array<{ period: string } & Record<string, number | string>>;
  periods: ReadonlyArray<{ period: string; end: string }>;
  categories: CategoryAmount[];
  colors: Record<string, string>;
  labelFor: (category: string) => string;
  granularity: Granularity;
  locale: string;
  currency: string;
  card: AnalysisCardProps;
}) {
  const t = useTranslations('financialAnalysis');
  const keys = categories.map((row) => row.category);
  const labels = periodLabels(granularity, locale);
  const ends = useMemo(() => new Map(periods.map((row) => [row.period, row.end])), [periods]);
  const points = useMemo(() => rows.map((row) => ({ ...row, iso: row.period, end: ends.get(row.period) })), [rows, ends]);
  const chart = useDayChart(points, undefined, { evenlySpaced: true });
  const drawn = pointsWithin(chart.points, chart.zoomed);
  const colorOf = (key: string) => colors[key] ?? colors[OTHER_CATEGORY];
  const series: ChartLegendItem[] = keys.map((key) => ({ key, label: labelFor(key), color: colorOf(key), swatch: 'square' }));
  const { legend, shown, opacity, hidden } = useChartLegend(t('categoryTrendTitle'), series);
  const [stack] = shownStacks([keys], hidden);
  const axis = niceAxis([0, ...stackedValues(drawn as Array<Record<string, unknown>>, [stack])]);
  const open = chart.openRow;

  return (
    <AnalysisChartCard
      card={card}
      chart={chart}
      legend={legend}
      range={labels.range(drawn[0], drawn[drawn.length - 1])}
      details={detailRows(series, hidden, open)}
      detailsLabel={open ? labels.title(open.period, open.end) : undefined}
      currency={currency}
    >
      <BarChart accessibilityLayer data={drawn} margin={chartMargin} barCategoryGap="22%" onClick={chart.dayClick(drawn)}>
        <CartesianGrid {...chartGrid} />
        <XAxis dataKey="period" {...chartTimeAxis} tickFormatter={labels.tick} />
        <YAxis {...chartValueAxis} domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={distinctMoneyTick(axis.ticks, locale)} />
        <Tooltip
          cursor={chartBarCursor}
          content={chart.mobile ? noTooltip : tooltipContent(currency, (period) => labels.title(String(period), ends.get(String(period))), series)}
        />
        {keys.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            hide={!shown(key)}
            stackId="expenses"
            fill={colorOf(key)}
            fillOpacity={opacity(key)}
            {...chartBar}
            {...stackTop(key === stack[stack.length - 1])}
            {...chartAnimation(chart.reducedMotion || chart.filling)}
          />
        ))}
      </BarChart>
    </AnalysisChartCard>
  );
}

/**
 * One side's average money in per day for each week as bars, the week's
 * total in the tooltip and the details, and the average over every drawn
 * week as a dashed line. The card's stats stand above it (`card.children`).
 */
export function WeeklyAverageChart({ rows, side, average, locale, currency, card }: {
  rows: WeeklyAverageRow[];
  side: Side;
  average: number;
  locale: string;
  currency: string;
  card: AnalysisCardProps;
}) {
  const t = useTranslations('financialAnalysis');
  const value = side === 'gameClub' ? 'gameClubAverage' : 'barAverage';
  const total = side === 'gameClub' ? 'gameClubIncome' : 'barSales';
  const labels = periodLabels('week', locale);
  const points = useMemo(() => rows.map((row) => ({ ...row, iso: row.period })), [rows]);
  const chart = useDayChart(points, undefined, { evenlySpaced: true });
  const drawn = pointsWithin(chart.points, chart.zoomed);
  const byPeriod = new Map(rows.map((row) => [row.period, row]));
  const perDay: ChartLegendItem = { key: value, label: t('weeklyAveragePerDay'), color: SIDE_COLOR[side], swatch: 'square' };
  const overall: ChartLegendItem = { key: 'overall', label: t('weeklyAverageOverall'), color: chartColors.axis, swatch: 'dashed' };
  const { legend, shown, opacity } = useChartLegend(t(side === 'gameClub' ? 'weeklyAverageGameClubTitle' : 'weeklyAverageBarTitle'), [perDay, overall]);
  const axis = niceAxis([0, ...(shown(value) ? drawn.map((row) => row[value]) : []), ...(shown('overall') ? [average] : [])]);
  // The row carries the day average and, beside it, that week's total.
  const withWeekTotal = (row: WeeklyAverageRow | undefined) => ({
    ...perDay,
    format: (amount: number) => `${formatCurrency(amount)} ${currency} · ${t('weeklyAverageWeekTotal', { amount: row ? `${formatCurrency(row[total])} ${currency}` : '' })}`,
  });
  const open = chart.openRow;
  const details = open
    ? [
      ...(shown(value) ? [{ ...withWeekTotal(open), value: open[value] }] : []),
      ...(shown('overall') ? [{ key: overall.key, label: overall.label, color: overall.color, dashed: true, value: average }] : []),
    ]
    : [];

  return (
    <AnalysisChartCard
      card={card}
      chart={chart}
      legend={legend}
      range={labels.range(drawn[0], drawn[drawn.length - 1])}
      details={details}
      detailsLabel={open ? labels.title(open.period, open.end) : undefined}
      currency={currency}
    >
      <ComposedChart accessibilityLayer data={drawn} margin={chartMargin} barCategoryGap="22%" onClick={chart.dayClick(drawn)}>
        <CartesianGrid {...chartGrid} />
        <XAxis dataKey="period" {...chartTimeAxis} tickFormatter={labels.tick} />
        <YAxis {...chartValueAxis} domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={distinctMoneyTick(axis.ticks, locale)} />
        {shown('overall') && <ReferenceLine y={average} stroke={chartColors.axis} strokeOpacity={opacity('overall')} strokeDasharray={averageLine.strokeDasharray} />}
        <Tooltip
          cursor={chartBarCursor}
          content={chart.mobile ? noTooltip : tooltipContent(
            currency,
            (period) => labels.title(String(period), byPeriod.get(String(period))?.end),
            (period) => [withWeekTotal(byPeriod.get(String(period)))],
          )}
        />
        <Bar dataKey={value} hide={!shown(value)} {...chartBar} {...chartAnimation(chart.reducedMotion || chart.filling)}>
          {drawn.map((row) => (
            <Cell key={row.period} fill={SIDE_COLOR[side]} fillOpacity={opacity(value, row[value] >= average ? 1 : 0.55)} />
          ))}
        </Bar>
      </ComposedChart>
    </AnalysisChartCard>
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
 * monthly average as a dashed line and the margin on the right axis. The
 * card's stats stand above it (`card.children`).
 */
export function ProfitMonthsChart({ rows, average, locale, currency, card }: {
  rows: ProfitMonthRow[];
  average: number;
  locale: string;
  currency: string;
  card: AnalysisCardProps;
}) {
  const t = useTranslations('financialAnalysis');
  const months = monthLabels(locale);
  // A month is either a profit or a loss: two series on one stack, so each can be shown or hidden by its own pill.
  const data = useMemo(() => rows.map((row) => ({
    ...row,
    iso: `${row.month.slice(0, 7)}-01`,
    gain: row.profit >= 0 ? row.profit : null,
    loss: row.profit < 0 ? row.profit : null,
  })), [rows]);
  const chart = useDayChart(data, undefined, { evenlySpaced: true });
  const drawn = pointsWithin(chart.points, chart.zoomed);
  const margin = { key: 'marginPct', label: t('margin'), color: chartColors.purple, swatch: 'line' as const };
  const { legend, shown, opacity, hidden } = useChartLegend(t('overallSection'), [
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
  const axis = niceAxis([
    0,
    ...stackedValues(drawn, shownStacks([['gain', 'loss']] as const, hidden)),
    ...(shown('average') ? [average] : []),
  ]);
  const open = chart.openRow;
  // A month has a profit or a loss, never both, and may have no margin: only what it has is listed.
  const details = open
    ? tooltipSeries
      .filter((row) => !hidden.has(row.key))
      .flatMap((row) => {
        const value = open[row.key as 'gain' | 'loss' | 'marginPct'];
        return typeof value === 'number' ? [{ ...row, value }] : [];
      })
    : [];

  return (
    <AnalysisChartCard
      card={card}
      chart={chart}
      legend={legend}
      range={months.range(drawn[0], drawn[drawn.length - 1])}
      details={details}
      detailsLabel={open ? months.title(open.month) : undefined}
      currency={currency}
    >
      <ComposedChart accessibilityLayer data={drawn} margin={{ ...chartMargin, right: 0 }} barCategoryGap="28%" onClick={chart.dayClick(drawn)}>
        <CartesianGrid {...chartGrid} />
        <XAxis
          dataKey="month"
          {...chartTimeAxis}
          interval={drawn.length > 12 ? 'preserveStartEnd' : 0}
          tickFormatter={(month: string) => formatMonthShort(month, locale)}
        />
        <YAxis yAxisId="money" {...chartValueAxis} domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={distinctMoneyTick(axis.ticks, locale)} />
        <YAxis yAxisId="pct" orientation="right" {...chartValueAxis} width={36} tickFormatter={(value: number) => `${value}%`} />
        <ReferenceLine yAxisId="money" y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
        {shown('average') && <ReferenceLine yAxisId="money" y={average} stroke={chartColors.axis} strokeOpacity={opacity('average')} strokeDasharray={averageLine.strokeDasharray} />}
        <Tooltip
          cursor={chartBarCursor}
          content={chart.mobile ? noTooltip : tooltipContent(currency, (month) => months.title(String(month)), tooltipSeries)}
        />
        <Bar yAxisId="money" dataKey="gain" stackId="profit" hide={!shown('gain')} fill={chartColors.success} fillOpacity={opacity('gain')} {...chartBar} maxBarSize={36} {...chartAnimation(chart.reducedMotion || chart.filling)} />
        <Bar yAxisId="money" dataKey="loss" stackId="profit" hide={!shown('loss')} fill={chartColors.danger} fillOpacity={opacity('loss')} {...chartBar} maxBarSize={36} {...chartAnimation(chart.reducedMotion || chart.filling)} />
        <Line
          yAxisId="pct"
          dataKey="marginPct"
          hide={!shown('marginPct')}
          stroke={chartColors.purple}
          strokeOpacity={opacity('marginPct')}
          {...chartLine}
          dot={{ r: 3 }}
          activeDot={chartActiveDot(chartColors.purple)}
          connectNulls
        />
      </ComposedChart>
    </AnalysisChartCard>
  );
}

/** Owner money per month: each side's withdrawals stacked under what is still left to take. */
export function OwnerMonthsChart({ rows, locale, currency, card }: { rows: OwnerMonthRow[]; locale: string; currency: string; card: AnalysisCardProps }) {
  const t = useTranslations('financialAnalysis');
  const months = monthLabels(locale);
  const data = useMemo(() => rows.map((row) => ({ ...row, iso: `${row.month.slice(0, 7)}-01` })), [rows]);
  const chart = useDayChart(data, undefined, { evenlySpaced: true });
  const drawn = pointsWithin(chart.points, chart.zoomed);
  const series: ChartLegendItem[] = [
    { key: 'gameClubWithdrawn', label: t('tableGameClubWithdrawn'), color: chartColors.primary, swatch: 'square' },
    { key: 'gameClubLeft', label: t('gameClubLeftToTake'), color: chartColors.success, swatch: 'square' },
    { key: 'barWithdrawn', label: t('tableBarWithdrawn'), color: chartColors.orange, swatch: 'square' },
    { key: 'barLeft', label: t('barLeftToTake'), color: chartColors.purple, swatch: 'square' },
  ];
  const { legend, shown, opacity, hidden } = useChartLegend(t('ownerChartTitle'), series);
  // Each side is its own column: the game club's and the bar's money are never stacked together.
  const axis = niceAxis([0, ...stackedValues(drawn, shownStacks([['gameClubWithdrawn', 'gameClubLeft'], ['barWithdrawn', 'barLeft']] as const, hidden))]);
  const animation = chartAnimation(chart.reducedMotion || chart.filling);
  const open = chart.openRow;

  return (
    <AnalysisChartCard
      card={card}
      chart={chart}
      legend={legend}
      range={months.range(drawn[0], drawn[drawn.length - 1])}
      details={detailRows(series, hidden, open)}
      detailsLabel={open ? months.title(open.month) : undefined}
      currency={currency}
    >
      <BarChart accessibilityLayer data={drawn} margin={chartMargin} barGap={4} barCategoryGap="26%" onClick={chart.dayClick(drawn)}>
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
          content={chart.mobile ? noTooltip : tooltipContent(currency, (month) => months.title(String(month)), series)}
        />
        <Bar dataKey="gameClubWithdrawn" hide={!shown('gameClubWithdrawn')} stackId="gameClub" fill={chartColors.primary} fillOpacity={opacity('gameClubWithdrawn')} {...chartBar} {...stackTop(!shown('gameClubLeft'))} maxBarSize={30} {...animation} />
        <Bar dataKey="gameClubLeft" hide={!shown('gameClubLeft')} stackId="gameClub" fill={chartColors.success} fillOpacity={opacity('gameClubLeft')} {...chartBar} maxBarSize={30} {...animation} />
        <Bar dataKey="barWithdrawn" hide={!shown('barWithdrawn')} stackId="bar" fill={chartColors.orange} fillOpacity={opacity('barWithdrawn')} {...chartBar} {...stackTop(!shown('barLeft'))} maxBarSize={30} {...animation} />
        <Bar dataKey="barLeft" hide={!shown('barLeft')} stackId="bar" fill={chartColors.purple} fillOpacity={opacity('barLeft')} {...chartBar} maxBarSize={30} {...animation} />
      </BarChart>
    </AnalysisChartCard>
  );
}

/**
 * This month's running money in for one side: actual so far as the lead
 * area, the dashed forecast at the current pace through month end, and last
 * month by day as a thin line; each line's latest value in view sits at its
 * right end. The card's stats stand above it (`card.children`).
 */
export function ForecastChart({ forecast, side, locale, currency, card }: {
  forecast: MonthForecast;
  side: ForecastSide;
  locale: string;
  currency: string;
  card: AnalysisCardProps;
}) {
  const t = useTranslations('financialAnalysis');
  const gradientId = useId().replace(/:/g, '');
  const keys = { actual: `${side}Actual`, projected: `${side}Projected`, lastMonth: `${side}LastMonth` } as const;
  const isoOf = (day: number) => `${forecast.month}-${String(day).padStart(2, '0')}`;
  const data = useMemo(() => forecast.days.map((row) => ({ ...row, iso: `${forecast.month}-${String(row.day).padStart(2, '0')}` })), [forecast]);
  // One step a day: the x of a point is its day of the month, less one.
  const chart = useDayChart(data, undefined, { evenlySpaced: true });
  const { zoomed, mobile } = chart;
  const actual: ChartLegendItem = { key: keys.actual, label: t('forecastActual'), color: SIDE_COLOR[side], swatch: 'line' };
  const projected: ChartLegendItem = { key: keys.projected, label: t('forecastProjected'), color: SIDE_COLOR[side], swatch: 'dashed' };
  const lastMonth: ChartLegendItem = { key: keys.lastMonth, label: t('forecastLastMonth'), color: chartColors.gray, swatch: 'line' };
  const lines = [lastMonth, projected, actual];
  const { legend, shown, opacity, hidden } = useChartLegend(
    t(side === 'gameClub' ? 'forecastGameClubTitle' : side === 'bar' ? 'forecastBarTitle' : 'forecastPlaystationTitle'),
    [actual, projected, lastMonth],
  );
  const valueOf = (row: (typeof data)[number], key: string) => {
    const value = (row as unknown as Record<string, unknown>)[key];
    return typeof value === 'number' ? value : null;
  };

  const drawn = zoomed ? pointsInView(chart.points, zoomed) : chart.points;
  const within = pointsWithin(chart.points, zoomed);
  const shownLines = lines.filter((line) => shown(line.key));
  const axis = niceAxis([0, ...drawn.flatMap((row) => shownLines.map((line) => valueOf(row, line.key)).filter((value): value is number => value !== null))]);
  const endLabels = endLabelsFor(
    shownLines.map((line) => ({ value: seriesEnds(within.map((row) => valueOf(row, line.key)))?.last, color: line.color })),
    axis.domain,
    plotHeight(chart.chartHeight),
    endLabelMoney(locale),
  );
  const time = stepAxis(chart.points, zoomed, mobile ? 5 : 8);
  const dayAt = (timestamp: unknown) => chart.points[time.index(timestamp)]?.day;
  const open = chart.openRow;
  // Rows in drawing order: last month, the forecast, then the actual line on top; a day lists only the lines it has.
  const tooltipSeries = [lastMonth, { ...projected, dashed: true }, actual];
  const details = open
    ? tooltipSeries.filter((line) => !hidden.has(line.key)).flatMap((line) => {
      const value = valueOf(open, line.key);
      return value === null ? [] : [{ key: line.key, label: line.label, color: line.color, dashed: line.swatch === 'dashed', value }];
    })
    : [];
  const first = within[0];
  const last = within[within.length - 1];

  return (
    <AnalysisChartCard
      card={card}
      chart={chart}
      legend={legend}
      range={first && last ? formatDateRange(isoOf(first.day), isoOf(last.day), locale) : null}
      details={details}
      currency={currency}
    >
      <ComposedChart accessibilityLayer data={drawn} margin={chartMargin} onClick={chart.dayClick(drawn)}>
        <ChartGradient id={gradientId} color={SIDE_COLOR[side]} />
        <CartesianGrid {...chartGrid} />
        <XAxis
          {...chartTimeAxis}
          dataKey="timestamp"
          type="number"
          domain={time.domain}
          allowDataOverflow={!!zoomed}
          ticks={time.ticks}
          interval="preserveStartEnd"
          minTickGap={12}
          tickFormatter={(timestamp: number) => String(dayAt(timestamp) ?? '')}
        />
        <YAxis {...chartValueAxis} domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={distinctMoneyTick(axis.ticks, locale)} />
        {endLabels.length > 0 && (
          <YAxis
            yAxisId="ends"
            {...chartEndAxis}
            domain={axis.domain}
            ticks={endLabels.map((item) => item.at)}
            width={endLabelWidth(endLabels)}
            tick={<EndLabelTick labels={endLabels} />}
          />
        )}
        <Tooltip
          cursor={chartLineCursor}
          content={mobile ? noTooltip : tooltipContent(currency, (timestamp) => {
            const day = dayAt(timestamp);
            return day ? formatDate(isoOf(day), locale) : '';
          }, tooltipSeries)}
        />
        <Line dataKey={keys.lastMonth} hide={!shown(keys.lastMonth)} stroke={chartColors.gray} strokeOpacity={opacity(keys.lastMonth)} {...chartLine} strokeWidth={1.5} activeDot={chartActiveDot(chartColors.gray)} />
        <Line dataKey={keys.projected} hide={!shown(keys.projected)} stroke={SIDE_COLOR[side]} strokeOpacity={opacity(keys.projected)} {...plannedLine} type="linear" activeDot={chartActiveDot(SIDE_COLOR[side])} />
        <Area
          dataKey={keys.actual}
          hide={!shown(keys.actual)}
          {...leadArea(gradientId, SIDE_COLOR[side])}
          strokeOpacity={opacity(keys.actual)}
          fillOpacity={opacity(keys.actual)}
          {...chartAnimation(chart.reducedMotion || chart.filling)}
        />
      </ComposedChart>
    </AnalysisChartCard>
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
