'use client';

import { useCallback, useMemo, useState } from 'react';
import { dayTimestamp, pickedDay, viewportExtent, type Viewport } from '@/lib/chartViewport';
import { useChartViewport } from './useChartViewport';
import { useFullscreenCard } from './useFullscreenCard';
import { useIsMobile, usePrefersReducedMotion } from './useMediaQuery';

/** What a Recharts chart's `onClick` reports; null when the click landed outside the plot. */
export interface ChartClickState {
  activeTooltipIndex?: number;
}

/** One step of the time line: a day, or one bucket of an evenly spaced chart. */
export const DAY_MS = 86_400_000;

/** Renders nothing: on a phone the tooltip keeps tracking the touched day (its cursor marks it) without drawing under the finger. */
export const noTooltip = () => null;

/**
 * Everything a chart with one point per day needs to behave like the finance
 * app's: the card fills the window and comes back, in full screen it pans and
 * zooms through the days, and a tap or click on a day either opens that day's
 * details (a phone) or the day itself (`onSelectDay`, on a desktop).
 *
 * `rows` carry their ISO day; `points` are the same rows with the timestamp
 * the gestures and a time axis use. `zoomed` is the stretch shown while the
 * full-screen chart is zoomed in, null when every day is shown.
 *
 * `evenlySpaced` is for a point per week or month (`iso` its first day): each
 * row then takes one day-long step on the time line instead of its date, so
 * zooming stops at two buckets rather than two days, and `timestamp / DAY_MS`
 * is the row's index.
 */
export function useDayChart<T extends { iso: string }>(
  rows: readonly T[],
  onSelectDay?: (iso: string) => void,
  { evenlySpaced = false }: { evenlySpaced?: boolean } = {},
) {
  const mobile = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();
  const { open: filling, toggle: toggleFullscreen, close: closeFullscreen, chartRef, chartHeight } = useFullscreenCard();
  const points = useMemo(
    () => rows.map((row, index) => ({ ...row, timestamp: evenlySpaced ? index * DAY_MS : dayTimestamp(row.iso) })),
    [rows, evenlySpaced],
  );
  const extent = useMemo(() => viewportExtent(points), [points]);
  const { ref: viewportRef, view, whole, canZoomIn, zoom, reset, consumeDrag } = useChartViewport(extent, filling);
  const zoomed: Viewport | null = filling && !whole ? view : null;
  const [openDay, setOpenDay] = useState<string | null>(null);
  const closeDay = useCallback(() => setOpenDay(null), []);

  /**
   * The chart's `onClick` over the points it draws: a drag never opens a day,
   * nor does a neighbour drawn just outside a zoomed view; a phone opens the
   * day's details.
   */
  const dayClick = useCallback((drawn: ReadonlyArray<{ iso: string; timestamp: number }>) => (state: ChartClickState | null) => {
    if (consumeDrag()) return;
    const iso = pickedDay(drawn, state?.activeTooltipIndex, zoomed)?.iso;
    if (!iso) return;
    if (mobile) setOpenDay(iso);
    else onSelectDay?.(iso);
  }, [consumeDrag, mobile, onSelectDay, zoomed]);

  return {
    mobile,
    reducedMotion,
    /** The card fills the window (pass `{ open: filling, toggle: toggleFullscreen }` to `ChartCard`). */
    filling,
    toggleFullscreen,
    /** Returns the card to the page (when what it shows goes away). */
    closeFullscreen,
    /** On the chart's own box; its height while full screen. */
    chartRef,
    chartHeight,
    /** On the element around the chart, which the gestures listen to. */
    viewportRef,
    whole,
    canZoomIn,
    zoom,
    reset,
    points,
    zoomed,
    /** A tap or a click does something here: the details on a phone, the day on a desktop that can open it. */
    clickable: mobile || !!onSelectDay,
    dayClick,
    /** The day whose details are open (a phone), and its row. */
    openDay,
    openRow: openDay ? rows.find((row) => row.iso === openDay) ?? null : null,
    closeDay,
  };
}
