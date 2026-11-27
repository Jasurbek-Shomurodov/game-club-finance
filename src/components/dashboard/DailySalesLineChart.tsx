'use client';

import { useId } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { SIDE_ICONS } from '@/components/sideIcons';
import { ChartViewportTools } from '@/components/charts/ChartControls';
import { ChartDayDetails } from '@/components/charts/ChartDayDetails';
import { ChartHeadline } from '@/components/charts/ChartHeadline';
import { ChartGradient, EndLabelTick, endLabelWidth, endLabelsFor } from '@/components/charts/EndLabels';
import {
  chartActiveDot,
  chartAnimation,
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
} from '@/components/charts/chartLook';
import { noTooltip, useDayChart } from '@/components/charts/useDayChart';
import { fullscreenChartClassName } from '@/components/charts/useFullscreenCard';
import { navigableChartClassName } from '@/components/charts/useChartViewport';
import type { DailySalesLineRow } from '@/lib/calculations/dashboardMetrics';
import { seriesEnds } from '@/lib/calculations/chartHeadline';
import { evenTimeTicks, niceAxis } from '@/lib/chartScale';
import { pointsInView, pointsWithin, timestampDay } from '@/lib/chartViewport';
import { formatCurrency, formatDateRange, formatDateShort } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import {
  ChartCard,
  ChartLegendToggle,
  ChartTooltipBody,
  chartColors,
  formatAxis,
  seriesOpacity,
  seriesTotal,
  useSeriesVisibility,
} from './ChartCard';

interface DailySalesLineChartProps {
  /** One row per day: `date` as the page prints it, `iso` the day itself. */
  data: Array<DailySalesLineRow & { iso: string }>;
  /** Opens a tapped day (its daily report). */
  onSelectDay?: (date: string) => void;
}

const DAY_MS = 86_400_000;

// The game club leads as an area; PlayStation (a part of it) and the bar are thin lines beside it.
const SERIES = [
  { key: 'gameClub', color: chartColors.primary, icon: SIDE_ICONS.gameClub, lead: true },
  { key: 'playstation', color: chartColors.purple, icon: SIDE_ICONS.playstation, lead: false },
  { key: 'bar', color: chartColors.orange, icon: SIDE_ICONS.bar, lead: false },
] as const;

const SERIES_KEYS = SERIES.map((series) => series.key);

/** The plot's height in the card (h-64 on phones, sm:h-72), less the time axis, for spacing the end labels. */
const plotHeight = (boxHeight: number | undefined, mobile: boolean) => (boxHeight ?? (mobile ? 256 : 288)) - 38;

/**
 * Each day's Game Club, PlayStation and bar sales as lines on a time axis;
 * tap a legend pill to hide or show one. The headline is each side's total for
 * the days shown (never summed), each line's latest value sits at its right
 * end, a phone tap opens the day's details, and in full screen the lines pan
 * and zoom through the days.
 */
export function DailySalesLineChart({ data, onSelectDay }: DailySalesLineChartProps) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const currency = tc('currency');
  const gradientId = useId().replace(/:/g, '');
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const chart = useDayChart(data, onSelectDay);
  const { filling, toggleFullscreen, chartHeight, chartRef, viewportRef, zoomed, mobile, points } = chart;
  const seriesNames: Record<string, string> = {
    gameClub: t('gameClubIncome'),
    playstation: t('playstationIncome'),
    bar: t('barSales'),
  };
  const series = SERIES.map((item) => ({ ...item, label: seriesNames[item.key] }));
  const shown = series.filter((item) => !hidden.has(item.key));

  // Zoomed in, the lines run out to both edges through the days just outside; figures count only the days inside.
  const drawn = zoomed ? pointsInView(points, zoomed) : points;
  const within = pointsWithin(points, zoomed);
  const axis = niceAxis([
    0,
    ...drawn.flatMap((row) => shown.map((item) => row[item.key]).filter((value): value is number => typeof value === 'number')),
  ]);
  const ends = endLabelsFor(
    shown.map((item) => ({ value: seriesEnds(within.map((row) => row[item.key]))?.last, color: item.color })),
    axis.domain,
    plotHeight(chartHeight, mobile),
    endLabelMoney(locale),
  );

  const first = points[0]?.timestamp;
  const last = points[points.length - 1]?.timestamp;
  const timeDomain: [number, number] | undefined = zoomed
    ? [zoomed.start, zoomed.end]
    : first === undefined || last === undefined ? undefined : [first, last === first ? first + DAY_MS : last];
  const timeTicks = timeDomain ? evenTimeTicks(timeDomain[0], timeDomain[1], mobile ? 4 : 6) : undefined;
  // The tooltip asks with no day before one is hovered.
  const dayLabel = (timestamp: unknown) => (Number.isFinite(Number(timestamp)) && timestamp !== null && timestamp !== undefined
    ? formatDateShort(timestampDay(Number(timestamp)), locale)
    : '');

  const open = chart.openRow;
  const dayRows = open
    ? shown.map((item) => ({ ...item, value: open[item.key] }))
    : [];

  // Each side's own total for the days shown; PlayStation is part of the game club's, so it gets none of its own.
  const headline = (
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      {series.filter((item) => item.key !== 'playstation' && !hidden.has(item.key)).map((item) => (
        <ChartHeadline
          key={item.key}
          label={item.label}
          figure={formatCurrency(seriesTotal(within, (row) => row[item.key]))}
          unit={currency}
          locale={locale}
        />
      ))}
    </div>
  );

  const firstShown = within[0];
  const lastShown = within[within.length - 1];
  return (
    <ChartCard
      title={t('dailySales')}
      help={t('dailySalesHelp')}
      headline={headline}
      fullscreen={{ open: filling, toggle: toggleFullscreen }}
      action={(
        <ChartLegendToggle
          label={t('chartLegendLabel', { title: t('dailySales') })}
          hidden={hidden}
          onToggle={(key) => toggle(key, SERIES_KEYS)}
          onFocus={setFocused}
          items={series.map((item) => ({
            ...item,
            swatch: 'line' as const,
            total: formatAxis(seriesTotal(within, (row) => row[item.key]), locale),
          }))}
        />
      )}
    >
      {filling && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Zoomed in: which days the headline now covers. */}
          {zoomed && firstShown && lastShown && <p className="text-xs font-medium text-gray-600">{formatDateRange(firstShown.iso, lastShown.iso, locale)}</p>}
          <ChartViewportTools className="ml-auto" whole={chart.whole} canZoomIn={chart.canZoomIn} onZoom={chart.zoom} onReset={chart.reset} />
        </div>
      )}
      <div ref={chartRef} className={cn('mt-3', filling ? fullscreenChartClassName : 'h-64 sm:h-72')}>
        <div
          ref={viewportRef}
          className={cn('h-full', filling ? navigableChartClassName : chart.clickable && 'cursor-pointer')}
        >
          <ResponsiveContainer width="100%" height={filling && chartHeight ? chartHeight : '100%'}>
            <ComposedChart accessibilityLayer data={drawn} margin={chartMargin} onClick={chart.dayClick(drawn)}>
              <ChartGradient id={gradientId} color={chartColors.primary} />
              <CartesianGrid {...chartGrid} />
              <XAxis
                {...chartTimeAxis}
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={timeDomain ?? ['dataMin', 'dataMax']}
                allowDataOverflow={!!zoomed}
                ticks={timeTicks}
                interval="preserveStartEnd"
                minTickGap={32}
                tickFormatter={dayLabel}
              />
              <YAxis
                {...chartValueAxis}
                domain={axis.domain}
                ticks={axis.ticks}
                allowDataOverflow
                tickFormatter={distinctMoneyTick(axis.ticks, locale)}
              />
              {ends.length > 0 && (
                <YAxis
                  yAxisId="ends"
                  {...chartEndAxis}
                  domain={axis.domain}
                  ticks={ends.map((item) => item.at)}
                  width={endLabelWidth(ends)}
                  tick={<EndLabelTick labels={ends} />}
                />
              )}
              <Tooltip
                cursor={chartLineCursor}
                content={mobile ? noTooltip : ({ active, label, payload }) => (
                  <ChartTooltipBody active={active} label={dayLabel(label)} payload={payload} series={series} currency={currency} />
                )}
              />
              {SERIES.map((item) => (item.lead ? (
                <Area
                  key={item.key}
                  dataKey={item.key}
                  name={item.key}
                  hide={hidden.has(item.key)}
                  {...leadArea(gradientId, item.color)}
                  strokeWidth={focused === item.key ? 3 : 2.5}
                  strokeOpacity={seriesOpacity(item.key, focused)}
                  fillOpacity={seriesOpacity(item.key, focused)}
                  {...chartAnimation(chart.reducedMotion || filling)}
                />
              ) : (
                <Line
                  key={item.key}
                  dataKey={item.key}
                  name={item.key}
                  hide={hidden.has(item.key)}
                  stroke={item.color}
                  {...chartLine}
                  strokeWidth={focused === item.key ? 3 : 2}
                  strokeOpacity={seriesOpacity(item.key, focused)}
                  activeDot={chartActiveDot(item.color)}
                />
              )))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ChartDayDetails
        open={!!open}
        onClose={chart.closeDay}
        date={chart.openDay}
        rows={dayRows}
        currency={currency}
        description={t('dailySales')}
        onOpenDay={onSelectDay}
      />
    </ChartCard>
  );
}
