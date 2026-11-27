/**
 * The one look every time chart shares: grid, axes, cursors, bars, lines,
 * the lead area and the end-label axis. Spread these into the Recharts pieces
 * (`<CartesianGrid {...chartGrid} />`, `<Bar {...chartBar} dataKey="…" />`)
 * instead of writing props inline, so a change here changes every chart.
 * Colours come from `chartColors`; this file imports nothing from Recharts.
 */
import { formatCurrency, intlLocaleFor } from '@/lib/formatters';
import { distinctTickFormat } from '@/lib/chartScale';
import { CHART_Y_AXIS_WIDTH, chartColors, formatAxis } from '@/components/dashboard/ChartCard';

/** Room around the plot; the axes bring their own tick margins. */
export const chartMargin = { top: 8, right: 4, bottom: 0, left: 0 };

/** Faint horizontal guides only. */
export const chartGrid = { stroke: chartColors.grid, strokeDasharray: '3 4', vertical: false } as const;

const chartTick = { fontSize: 11, fill: chartColors.axis };

/** The time (or category) axis along the bottom: labels on a hairline, no tick marks. */
export const chartTimeAxis = { tick: chartTick, tickLine: false, axisLine: { stroke: chartColors.grid }, minTickGap: 16 } as const;

/** The value axis on the left: labels only, in a gutter wide enough for "4,5 млн". */
export const chartValueAxis = { tick: chartTick, tickLine: false, axisLine: false, width: CHART_Y_AXIS_WIDTH } as const;

/** The column highlight behind a hovered bar. */
export const chartBarCursor = { fill: chartColors.cursor, radius: 6 } as const;
/** The upright guide on a hovered day of a line chart. */
export const chartLineCursor = { stroke: chartColors.axis, strokeDasharray: '3 3' } as const;

/** A column, rounded on top. */
export const chartBar = { radius: [4, 4, 0, 0] as [number, number, number, number], maxBarSize: 28 };
/** In a stack, only the top series gets the rounded corners. */
export const stackTop = (top: boolean) => ({ radius: top ? chartBar.radius : ([0, 0, 0, 0] as [number, number, number, number]) });

/** Bars and areas grow in over half a second, unless the person asked for reduced motion. */
export const chartAnimation = (reducedMotion: boolean) => ({ isAnimationActive: !reducedMotion, animationDuration: 500 });

/** A thin comparison line; never animated. */
export const chartLine = { type: 'monotone', strokeWidth: 2, dot: false, isAnimationActive: false, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
/** A running average or another guide drawn over the bars: dashed, with a small marker on the hovered day. */
export const averageLine = { ...chartLine, strokeDasharray: '5 3', activeDot: { r: 3 } } as const;
/** What is planned or projected rather than recorded: the line's own colour, dashed longer. */
export const plannedLine = { ...chartLine, strokeDasharray: '6 5' } as const;

/** The marker on the hovered day of a line: a ring in the line's colour around the card colour. */
export const chartActiveDot = (color: string) => ({ r: 4.5, strokeWidth: 2, stroke: 'rgb(var(--c-surface))', fill: color });

/**
 * The lead series as an area with a fading fill: put `<ChartGradient id={id} color={color} />`
 * in the chart and pass the same id. Comparisons stay `chartLine`.
 */
export const leadArea = (id: string, color: string) => ({
  type: 'monotone' as const,
  stroke: color,
  strokeWidth: 2.5,
  fill: `url(#${id})`,
  dot: false as const,
  activeDot: chartActiveDot(color),
});

/**
 * The second value axis at the right that carries the end labels: pass the
 * positions from `spreadLabels` as its `ticks`, `endLabelWidth(labels)` as
 * its `width`, and `<EndLabelTick labels={labels} />` as its `tick`.
 */
export const chartEndAxis = { axisLine: false, tickLine: false, tickMargin: 6, orientation: 'right', interval: 0, allowDataOverflow: true } as const;

const preciseFormatters = new Map<string, Intl.NumberFormat>();

/** Compact, with three significant digits ("1,45 млн"), so close figures stay apart. */
export function formatAxisPrecise(value: number, locale: string): string {
  const tag = intlLocaleFor(locale);
  let formatter = preciseFormatters.get(tag);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(tag, { notation: 'compact', maximumSignificantDigits: 3 });
    } catch {
      formatter = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumSignificantDigits: 3 });
    }
    preciseFormatters.set(tag, formatter);
  }
  return formatter.format(value);
}

/**
 * Value-axis ticks that never read the same: compact while that tells them
 * apart, then three significant digits, then the whole amount.
 */
export function distinctMoneyTick(ticks: readonly number[], locale: string): (value: unknown) => string {
  const format = distinctTickFormat(ticks, [
    (value) => formatAxis(value, locale),
    (value) => formatAxisPrecise(value, locale),
    (value) => formatCurrency(value),
  ]);
  return (value) => format(Number(value));
}

/** A line's end label: compact, but precise enough to tell close lines apart. */
export const endLabelMoney = (locale: string) => (value: number) => formatAxisPrecise(value, locale);
