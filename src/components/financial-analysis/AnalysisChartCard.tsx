'use client';

import { useEffect, type ReactElement, type ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { ChartViewportTools } from '@/components/charts/ChartControls';
import { ChartDayDetails, type DayDetailRow } from '@/components/charts/ChartDayDetails';
import type { useDayChart } from '@/components/charts/useDayChart';
import { fullscreenChartClassName } from '@/components/charts/useFullscreenCard';
import { navigableChartClassName } from '@/components/charts/useChartViewport';
import { ChartCard } from '@/components/dashboard/ChartCard';
import { cn } from '@/lib/utils';

/** What the page says about a financial-analysis chart card. */
export interface AnalysisCardProps {
  title: string;
  description?: string;
  /** Explanation behind a "?" beside the title. */
  help?: string;
  className?: string;
  /**
   * Shown in place of the chart: nothing to draw yet, still loading or failed
   * to load. The card then has no headline and no full-screen button.
   */
  placeholder?: ReactNode;
  /** Figures above the chart (the card's stats); they stay with it in full screen. */
  children?: ReactNode;
}

type DayChartState = Pick<
  ReturnType<typeof useDayChart>,
  'filling' | 'toggleFullscreen' | 'closeFullscreen' | 'chartRef' | 'chartHeight' | 'viewportRef' | 'whole' | 'canZoomIn' | 'zoom' | 'reset' | 'zoomed' | 'clickable' | 'openDay' | 'closeDay'
>;

/**
 * The card around a financial-analysis time chart, behaving like the
 * dashboard's: the headline under the title, the legend pills, a full-screen
 * button that makes the card fill the window, where the chart pans and zooms
 * (`range` then says what is in view), and on a phone the details window a
 * tap opens (`details`, one row per series: the game club and the bar are
 * never added together). The chart itself is the Recharts element passed as
 * `children`; it lays out to the box's height.
 */
export function AnalysisChartCard({ card, chart, legend, headline, heightClassName = 'h-64', range, details, detailsLabel, currency, children }: {
  card: AnalysisCardProps;
  chart: DayChartState;
  legend: ReactNode;
  headline?: ReactNode;
  /** The chart box's height in the page (Tailwind classes). */
  heightClassName?: string;
  /** While zoomed in: the stretch in view, as words. */
  range?: string | null;
  /** The open point's series and values. */
  details: readonly DayDetailRow[];
  /** The open point's name when it is a week or a month. */
  detailsLabel?: string;
  currency: string;
  children: ReactElement;
}) {
  const { title, description, help, className, placeholder, children: figures } = card;
  const { filling, toggleFullscreen, closeFullscreen, chartRef, chartHeight, viewportRef, whole, canZoomIn, zoom, reset, zoomed, clickable, openDay, closeDay } = chart;
  // The chart went away while the card filled the window (reloading, an error): give the page back.
  const showingPlaceholder = !!placeholder;
  useEffect(() => {
    if (showingPlaceholder && filling) closeFullscreen();
  }, [showingPlaceholder, filling, closeFullscreen]);
  if (placeholder) {
    return (
      // Until the card is back in the page, it keeps its exit button.
      <ChartCard title={title} description={description} help={help} className={className} fullscreen={filling ? { open: true, toggle: toggleFullscreen } : undefined}>
        {figures}
        {placeholder}
      </ChartCard>
    );
  }
  return (
    <ChartCard
      title={title}
      description={description}
      help={help}
      className={className}
      headline={headline}
      fullscreen={{ open: filling, toggle: toggleFullscreen }}
    >
      {figures}
      <div className="mt-3">{legend}</div>
      {filling && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {zoomed && range && <p className="text-xs font-medium text-gray-600">{range}</p>}
          <ChartViewportTools className="ml-auto" whole={whole} canZoomIn={canZoomIn} onZoom={zoom} onReset={reset} />
        </div>
      )}
      <div ref={chartRef} className={cn('mt-3', filling ? fullscreenChartClassName : heightClassName)}>
        <div ref={viewportRef} className={cn('h-full', filling ? navigableChartClassName : clickable && 'cursor-pointer')}>
          <ResponsiveContainer width="100%" height={filling && chartHeight ? chartHeight : '100%'}>
            {children}
          </ResponsiveContainer>
        </div>
      </div>
      <ChartDayDetails
        open={!!openDay}
        onClose={closeDay}
        date={openDay}
        dateLabel={detailsLabel}
        rows={details}
        currency={currency}
        description={title}
      />
    </ChartCard>
  );
}
