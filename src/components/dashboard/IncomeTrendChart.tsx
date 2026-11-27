'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import { Sigma } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { SIDE_ICONS } from '@/components/sideIcons';
import { ChartViewportTools } from '@/components/charts/ChartControls';
import { ChartDayDetails } from '@/components/charts/ChartDayDetails';
import { ChartHeadline } from '@/components/charts/ChartHeadline';
import { EndLabelTick, endLabelWidth, endLabelsFor } from '@/components/charts/EndLabels';
import {
  averageLine,
  chartAnimation,
  chartBar,
  chartBarCursor,
  chartEndAxis,
  chartGrid,
  chartMargin,
  chartTimeAxis,
  chartValueAxis,
  distinctMoneyTick,
  endLabelMoney,
} from '@/components/charts/chartLook';
import { noTooltip, useDayChart } from '@/components/charts/useDayChart';
import { fullscreenChartClassName } from '@/components/charts/useFullscreenCard';
import { navigableChartClassName } from '@/components/charts/useChartViewport';
import { seriesChange, seriesEnds } from '@/lib/calculations/chartHeadline';
import { niceAxis } from '@/lib/chartScale';
import { pointsWithin } from '@/lib/chartViewport';
import { formatCurrency, formatDateRange } from '@/lib/formatters';
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

export interface IncomeTrendRow {
  /** The day as the axis prints it. */
  date: string;
  /** The day as an ISO date: where the chart moves in full screen, and what `onSelectDay` opens. */
  iso: string;
  gameClubIncome: number;
  barSales: number;
  gameClubAverage?: number | null;
  barAverage?: number | null;
}

interface IncomeTrendChartProps {
  /** Each side's money in per day; the game club and the bar are never summed. */
  data: IncomeTrendRow[];
  /** Optional header link, e.g. to the full financial analysis. */
  link?: ReactNode;
  /** Opens the day behind a tapped bar (its daily report). */
  onSelectDay?: (date: string) => void;
}

// Legend pills: each side hides its bars and its average line; "averages" hides both averages.
const TOGGLE_KEYS = ['gameClub', 'bar', 'averages'] as const;

/** The plot's height in the card (h-64 on phones, sm:h-72), less the time axis, for spacing the end labels. */
const plotHeight = (boxHeight: number | undefined, mobile: boolean) => (boxHeight ?? (mobile ? 256 : 288)) - 38;

/**
 * Each side's money in per day as bars, with each side's running daily
 * average over them. The headline is each side's latest average and how it
 * moved over the days shown; the averages' latest values sit at the right end.
 * On a phone a tap opens the day's details; on a desktop a click opens the
 * day. In full screen the bars pan and zoom through the days.
 */
export function IncomeTrendChart({ data, link, onSelectDay }: IncomeTrendChartProps) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const currency = tc('currency');
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const chart = useDayChart(data, onSelectDay);
  const { filling, toggleFullscreen, chartHeight, chartRef, viewportRef, zoomed, mobile } = chart;
  // Bars take one slot per day, so only the days in view are drawn.
  const drawn = pointsWithin(chart.points, zoomed);

  const seriesNames: Record<string, string> = {
    gameClubIncome: t('gameClubIncome'),
    barSales: t('barSales'),
    gameClubAverage: t('gameClubDailyAverage'),
    barAverage: t('barDailyAverage'),
  };
  const showGameClub = !hidden.has('gameClub');
  const showBar = !hidden.has('bar');
  const showAverages = !hidden.has('averages');
  // A hovered pill spotlights its group: a side's bars and average, or both averages.
  const opacity = (side: 'gameClub' | 'bar', average = false) =>
    focused === 'averages' ? (average ? 1 : 0.15) : seriesOpacity(side, focused);

  const sides = [
    { key: 'gameClub', shown: showGameClub, income: 'gameClubIncome', average: 'gameClubAverage', color: chartColors.primary, icon: SIDE_ICONS.gameClub },
    { key: 'bar', shown: showBar, income: 'barSales', average: 'barAverage', color: chartColors.orange, icon: SIDE_ICONS.bar },
  ] as const;
  const averages = (side: (typeof sides)[number]) => drawn.map((row) => row[side.average]);

  // The value axis fits what is drawn, from zero (bars stand on it).
  const axis = niceAxis([
    0,
    ...sides.flatMap((side) => (side.shown ? [
      ...drawn.map((row) => row[side.income]),
      ...(showAverages ? averages(side).filter((value): value is number => typeof value === 'number') : []),
    ] : [])),
  ]);
  const ends = showAverages
    ? endLabelsFor(
      sides.filter((side) => side.shown).map((side) => ({ value: seriesEnds(averages(side))?.last, color: side.color })),
      axis.domain,
      plotHeight(chartHeight, mobile),
      endLabelMoney(locale),
    )
    : [];

  const tooltipSeries = [
    { key: 'gameClubIncome', label: seriesNames.gameClubIncome, color: chartColors.primary, icon: SIDE_ICONS.gameClub },
    { key: 'barSales', label: seriesNames.barSales, color: chartColors.orange, icon: SIDE_ICONS.bar },
    { key: 'gameClubAverage', label: seriesNames.gameClubAverage, color: chartColors.primary, dashed: true },
    { key: 'barAverage', label: seriesNames.barAverage, color: chartColors.orange, dashed: true },
  ];
  const shownSeries = tooltipSeries.filter((row) => (
    (row.key.startsWith('gameClub') ? showGameClub : showBar) && (!row.dashed || showAverages)
  ));
  const open = chart.openRow;
  const dayRows = open
    ? shownSeries.map((row) => {
      const value = open[row.key as keyof IncomeTrendRow];
      return { ...row, value: typeof value === 'number' ? value : null };
    })
    : [];

  // Each side's own headline: its latest daily average and how it moved over the days shown. Never summed.
  const headline = (
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      {sides.filter((side) => side.shown).map((side) => {
        const values = averages(side);
        const last = seriesEnds(values)?.last;
        return (
          <ChartHeadline
            key={side.key}
            label={seriesNames[side.average]}
            figure={formatCurrency(last ?? 0)}
            unit={currency}
            change={seriesChange(values)}
            locale={locale}
          />
        );
      })}
    </div>
  );

  const first = drawn[0];
  const last = drawn[drawn.length - 1];
  return (
    <ChartCard
      title={t('incomeTrend')}
      headline={headline}
      fullscreen={{ open: filling, toggle: toggleFullscreen }}
      action={(
        <div className="flex flex-wrap items-center gap-2">
          <ChartLegendToggle
            label={t('chartLegendLabel', { title: t('incomeTrend') })}
            hidden={hidden}
            onToggle={(key) => toggle(key, TOGGLE_KEYS)}
            onFocus={setFocused}
            items={[
              {
                key: 'gameClub',
                label: seriesNames.gameClubIncome,
                color: chartColors.primary,
                swatch: 'square',
                icon: SIDE_ICONS.gameClub,
                total: formatAxis(seriesTotal(drawn, (row) => row.gameClubIncome), locale),
              },
              {
                key: 'bar',
                label: seriesNames.barSales,
                color: chartColors.orange,
                swatch: 'square',
                icon: SIDE_ICONS.bar,
                total: formatAxis(seriesTotal(drawn, (row) => row.barSales), locale),
              },
              { key: 'averages', label: t('dailyAverages'), color: chartColors.gray, swatch: 'dashed', icon: Sigma },
            ]}
          />
          {link}
        </div>
      )}
    >
      {filling && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Zoomed in: which days the headline and the bars now cover. */}
          {zoomed && first && last && <p className="text-xs font-medium text-gray-600">{formatDateRange(first.iso, last.iso, locale)}</p>}
          <ChartViewportTools className="ml-auto" whole={chart.whole} canZoomIn={chart.canZoomIn} onZoom={chart.zoom} onReset={chart.reset} />
        </div>
      )}
      <div ref={chartRef} className={cn('mt-3', filling ? fullscreenChartClassName : 'h-64 sm:h-72')}>
        <div
          ref={viewportRef}
          className={cn('h-full', filling ? navigableChartClassName : chart.clickable && 'cursor-pointer')}
        >
          <ResponsiveContainer width="100%" height={filling && chartHeight ? chartHeight : '100%'}>
            <ComposedChart
              accessibilityLayer
              data={drawn}
              margin={chartMargin}
              barGap={2}
              barCategoryGap="25%"
              onClick={chart.dayClick(drawn)}
            >
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="date" {...chartTimeAxis} />
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
                cursor={chartBarCursor}
                content={mobile ? noTooltip : ({ active, label, payload }) => (
                  <ChartTooltipBody active={active} label={label} payload={payload} series={tooltipSeries} currency={currency} />
                )}
              />
              {/* Bars do not grow in while the full-screen chart moves through the days. */}
              <Bar dataKey="gameClubIncome" name="gameClubIncome" hide={!showGameClub} fill={chartColors.primary} fillOpacity={opacity('gameClub')} {...chartBar} {...chartAnimation(chart.reducedMotion || filling)} />
              <Bar dataKey="barSales" name="barSales" hide={!showBar} fill={chartColors.orange} fillOpacity={opacity('bar')} {...chartBar} {...chartAnimation(chart.reducedMotion || filling)} />
              {/* Running averages through each day; they stop after a side's latest entry. */}
              <Line dataKey="gameClubAverage" name="gameClubAverage" hide={!showGameClub || !showAverages} stroke={chartColors.primary} strokeOpacity={opacity('gameClub', true)} {...averageLine} />
              <Line dataKey="barAverage" name="barAverage" hide={!showBar || !showAverages} stroke={chartColors.orange} strokeOpacity={opacity('bar', true)} {...averageLine} />
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
        description={t('incomeTrend')}
        onOpenDay={onSelectDay}
      />
    </ChartCard>
  );
}
