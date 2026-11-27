'use client';

import { useId, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ChartLegendToggle,
  ChartTooltipBody,
  chartColors,
  formatAxis,
  seriesOpacity,
  seriesTotal,
  useSeriesVisibility,
} from '@/components/dashboard/ChartCard';
import { ChartViewportTools, FullscreenToggle } from '@/components/charts/ChartControls';
import { ChartDayDetails } from '@/components/charts/ChartDayDetails';
import {
  chartAnimation,
  chartBar,
  chartBarCursor,
  chartGrid,
  chartMargin,
  chartTimeAxis,
  chartValueAxis,
  distinctMoneyTick,
} from '@/components/charts/chartLook';
import { noTooltip, useDayChart } from '@/components/charts/useDayChart';
import { fullscreenCardClassName, fullscreenChartClassName } from '@/components/charts/useFullscreenCard';
import { navigableChartClassName } from '@/components/charts/useChartViewport';
import { niceAxis } from '@/lib/chartScale';
import { pointsWithin } from '@/lib/chartViewport';
import { formatCurrency, formatDateRange, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export interface DailyInOutRow {
  /** The day as an ISO date, or the month (`2026-11`) for a chart of months: what `onSelectDay` opens. */
  date: string;
  /** Already formatted for the axis. */
  label: string;
  income: number;
  expenses: number;
}

const KEYS = ['income', 'expenses'] as const;

/** A chart of months keys its rows `YYYY-MM`; one of days, `YYYY-MM-DD`. */
const isMonth = (date: string) => /^\d{4}-\d{2}$/.test(date);

/**
 * Money in and money out per day (or per month) as paired slim bars on one
 * axis, with a legend that shows or hides each series. One business per chart.
 * The host card already shows the period's figures above it, so the chart has
 * no headline of its own; the legend pills carry the totals of the bars shown.
 *
 * On a phone a tap opens the day's details (with "Open day report" when the
 * host passes `onSelectDay`); on a desktop the tooltip shows them and a click
 * opens the day. The full-screen button lays the chart over the page, where
 * it pans and zooms through the bars.
 */
export function DailyInOutChart({ data, incomeLabel, expensesLabel, legendLabel, currency, locale, incomeColor = chartColors.success, expensesColor = chartColors.danger, height = 220, onSelectDay }: {
  data: readonly DailyInOutRow[];
  incomeLabel: string;
  expensesLabel: string;
  legendLabel: string;
  currency: string;
  locale: string;
  incomeColor?: string;
  /** Second series colour; red (money out) unless the pair is not in/out. */
  expensesColor?: string;
  height?: number;
  /** Tapping a day's bars opens that day (its `date`); never called for a chart of months. */
  onSelectDay?: (date: string) => void;
}) {
  const headingId = useId();
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const rows = useMemo(() => data.map((row) => ({ ...row, iso: row.date })), [data]);
  // Only a day opens: a chart of months never hands a `YYYY-MM` to the host, and offers no day report.
  const monthly = data.some((row) => isMonth(row.date));
  const selectDay = useMemo(
    () => (onSelectDay && !monthly ? (date: string) => { if (!isMonth(date)) onSelectDay(date); } : undefined),
    [monthly, onSelectDay],
  );
  // One slot per bar: a gap between days (or a month) is never a wider gap on the plot.
  const chart = useDayChart(rows, selectDay, { evenlySpaced: true });
  const { filling, toggleFullscreen, chartHeight, chartRef, viewportRef, zoomed, mobile } = chart;
  const drawn = pointsWithin(chart.points, zoomed);

  const series = [
    { key: 'income', label: incomeLabel, color: incomeColor },
    { key: 'expenses', label: expensesLabel, color: expensesColor },
  ] as const;
  const shown = series.filter((row) => !hidden.has(row.key));
  const income = seriesTotal(drawn, (row) => row.income);
  const expenses = seriesTotal(drawn, (row) => row.expenses);
  // The value axis fits the bars drawn, from zero.
  const axis = niceAxis([0, ...shown.flatMap((item) => drawn.map((row) => row[item.key]))]);

  const open = chart.openRow;
  const dayRows = open ? shown.map((item) => ({ ...item, value: open[item.key] })) : [];
  const pointLabel = (date: string) => (isMonth(date) ? formatYearMonth(date, locale) : undefined);
  const first = drawn[0];
  const last = drawn[drawn.length - 1];
  const zoomedRange = zoomed && first && last
    ? isMonth(first.date) ? `${formatYearMonth(first.date, locale)} – ${formatYearMonth(last.date, locale)}` : formatDateRange(first.date, last.date, locale)
    : null;

  return (
    // In full screen this block, not the host card, fills the window: the chart is what is enlarged.
    <div
      className={cn('flex flex-col gap-3', filling && cn('bg-surface p-4 sm:p-5', fullscreenCardClassName))}
      data-fullscreen={filling || undefined}
      role={filling ? 'region' : undefined}
      aria-labelledby={filling ? headingId : undefined}
    >
      {filling && <h2 id={headingId} className="min-w-0 break-words text-sm font-semibold text-gray-950">{legendLabel}</h2>}
      <div className="flex items-start justify-between gap-2">
        <ChartLegendToggle
          label={legendLabel}
          hidden={hidden}
          onToggle={(key) => toggle(key, KEYS)}
          onFocus={setFocused}
          items={[
            { key: 'income', label: incomeLabel, color: incomeColor, swatch: 'square', total: formatAxis(income, locale) },
            { key: 'expenses', label: expensesLabel, color: expensesColor, swatch: 'square', total: formatAxis(expenses, locale) },
          ]}
        />
        <FullscreenToggle className="shrink-0" open={filling} onToggle={toggleFullscreen} />
      </div>
      {filling && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Zoomed in: which days the bars and the legend totals now cover. */}
          {zoomedRange && <p className="text-xs font-medium text-gray-600">{zoomedRange}</p>}
          <ChartViewportTools className="ml-auto" whole={chart.whole} canZoomIn={chart.canZoomIn} onZoom={chart.zoom} onReset={chart.reset} />
        </div>
      )}
      <div ref={chartRef} className={cn(filling && fullscreenChartClassName)} style={filling ? undefined : { height }}>
        <div
          ref={viewportRef}
          className={cn('h-full', filling ? navigableChartClassName : chart.clickable && 'cursor-pointer')}
          role="img"
          aria-label={`${legendLabel}: ${incomeLabel} ${formatCurrency(income)} ${currency}, ${expensesLabel} ${formatCurrency(expenses)} ${currency}`}
        >
          <ResponsiveContainer width="100%" height={filling && chartHeight ? chartHeight : '100%'}>
            <BarChart data={drawn} barGap={2} barCategoryGap="22%" margin={chartMargin} onClick={chart.dayClick(drawn)}>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="label" {...chartTimeAxis} />
              <YAxis {...chartValueAxis} domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={distinctMoneyTick(axis.ticks, locale)} />
              <Tooltip
                cursor={chartBarCursor}
                content={mobile ? noTooltip : ({ active, label, payload }) => (
                  <ChartTooltipBody active={active} label={label} payload={payload} series={shown} currency={currency} />
                )}
              />
              {/* Bars do not grow in while the full-screen chart moves through the days. */}
              {series.map((item) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  hide={hidden.has(item.key)}
                  fill={item.color}
                  fillOpacity={seriesOpacity(item.key, focused)}
                  {...chartBar}
                  maxBarSize={18}
                  {...chartAnimation(chart.reducedMotion || filling)}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ChartDayDetails
        open={!!open}
        onClose={chart.closeDay}
        date={chart.openDay}
        dateLabel={chart.openDay ? pointLabel(chart.openDay) : undefined}
        rows={dayRows}
        currency={currency}
        description={legendLabel}
        onOpenDay={chart.openDayReport}
      />
    </div>
  );
}
