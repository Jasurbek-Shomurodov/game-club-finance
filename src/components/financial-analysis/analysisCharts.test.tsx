import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';
import { AppLocaleContext } from '@/components/i18n/AppLocaleContext';
import type { PeriodSeriesRow } from '@/lib/calculations/analysisSeries';
import { DailyFlowChart, MonthlyTrendChart, detailRows, shownStacks } from './AnalysisTimeCharts';
import { CumulativeProfitChart, IncomeMixChart, SideFlowChart } from './OverallCharts';
import { AnalysisChartCard } from './AnalysisChartCard';
import { AnalysisChartCardSkeleton } from './AnalysisChartCardSkeleton';

// A static render has no layout to measure: draw the charts at a fixed size instead.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 640, height: 256 } as never),
  };
});

const render = (element: ReactElement) => renderToStaticMarkup(
  <AppLocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
    <NextIntlClientProvider locale="en" messages={messages}>{element}</NextIntlClientProvider>
  </AppLocaleContext.Provider>,
);

const card = { title: 'Chart title' };

const daily = [
  { date: '2026-11-01', gameClubIncome: 1_000_000, barSales: 200_000, barCost: 80_000, gameClubExpenses: 50_000, barExpenses: 10_000 },
  { date: '2026-11-02', gameClubIncome: 1_500_000, barSales: 300_000, barCost: 120_000, gameClubExpenses: 0, barExpenses: 0 },
];

const period = (period: string, end: string, gameClubLeft: number, barLeft: number, gameClubCumulative: number, barCumulative: number): PeriodSeriesRow => ({
  period,
  end,
  gameClubIncome: 2_000_000,
  gameClubSpent: 2_000_000 - gameClubLeft,
  gameClubLeft,
  barSales: 500_000,
  barSpent: 500_000 - barLeft,
  barLeft,
  computers: 1_500_000,
  playstation: 300_000,
  debts: 200_000,
  gameClubCumulative,
  barCumulative,
});

const weeks = [
  period('2026-11-02', '2026-11-08', 800_000, 150_000, 800_000, 150_000),
  period('2026-11-09', '2026-11-15', 600_000, -50_000, 1_400_000, 100_000),
  period('2026-11-16', '2026-11-22', 900_000, 120_000, 2_300_000, 220_000),
];

describe('DailyFlowChart', () => {
  it('heads with each side\'s own money in over the days shown, never one summed figure', () => {
    const html = render(<DailyFlowChart data={daily} locale="en" currency="UZS" card={card} />);
    expect(html).toContain('2 500 000');
    expect(html).toContain('500 000');
    // The two sides added together (2 500 000 + 500 000) appear nowhere.
    expect(html).not.toContain('3 000 000');
    expect(html).toContain('aria-label="Open in full screen"');
  });

  it('shows the placeholder instead of the chart, without a headline or full screen', () => {
    const html = render(<DailyFlowChart data={daily} locale="en" currency="UZS" card={{ ...card, placeholder: <p>Nothing yet</p> }} />);
    expect(html).toContain('Nothing yet');
    expect(html).not.toContain('2 500 000');
    expect(html).not.toContain('Open in full screen');
    expect(html).not.toContain('recharts-wrapper');
  });
});

describe('MonthlyTrendChart', () => {
  it('heads with each side\'s money in over the months shown', () => {
    const html = render(
      <MonthlyTrendChart
        data={[
          { month: '2026-10', gameClubIncome: 30_000_000, gameClubLeft: 9_000_000, barSales: 6_000_000, barLeft: 1_000_000 },
          { month: '2026-11', gameClubIncome: 20_000_000, gameClubLeft: 5_000_000, barSales: 4_000_000, barLeft: 500_000 },
        ]}
        locale="en"
        currency="UZS"
        card={card}
      />,
    );
    expect(html).toContain('50 000 000');
    expect(html).toContain('10 000 000');
    expect(html).not.toContain('60 000 000');
  });
});

describe('SideFlowChart', () => {
  it('heads with that side\'s profit over the buckets shown', () => {
    const gameClub = render(<SideFlowChart rows={weeks} side="gameClub" granularity="week" locale="en" currency="UZS" card={card} />);
    expect(gameClub).toContain('2 300 000');
    const bar = render(<SideFlowChart rows={weeks} side="bar" granularity="week" locale="en" currency="UZS" card={card} />);
    expect(bar).toContain('220 000');
  });
});

describe('CumulativeProfitChart', () => {
  it('heads with each side\'s latest running profit, never summed, and pins it at the line\'s end', () => {
    const html = render(<CumulativeProfitChart rows={weeks} granularity="week" locale="en" currency="UZS" card={card} />);
    expect(html).toContain('2 300 000');
    expect(html).toContain('220 000');
    expect(html).not.toContain('2 520 000');
    // Over every bucket the change line would only repeat the figure.
    expect(html).not.toContain('Change in period');
    expect(html).toContain('>2.3m</text>');
    expect(html).toContain('>220k</text>');
  });
});

describe('IncomeMixChart', () => {
  it('heads with the game club\'s money in, the sum of its own sources', () => {
    const html = render(<IncomeMixChart rows={weeks} granularity="week" locale="en" currency="UZS" card={card} />);
    expect(html).toContain('6 000 000');
  });
});

describe('detailRows', () => {
  const series = [
    { key: 'gameClubIncome', label: 'Game club', color: 'teal', swatch: 'line' as const },
    { key: 'barSales', label: 'Bar', color: 'orange', swatch: 'dashed' as const },
  ];

  it('lists each shown series on its own row with the point\'s value, a missing one as no entry', () => {
    expect(detailRows(series, new Set(), { gameClubIncome: 100, barSales: null })).toEqual([
      { key: 'gameClubIncome', label: 'Game club', color: 'teal', dashed: false, value: 100 },
      { key: 'barSales', label: 'Bar', color: 'orange', dashed: true, value: null },
    ]);
    expect(detailRows(series, new Set(['barSales']), { gameClubIncome: 100, barSales: 50 })).toHaveLength(1);
    expect(detailRows(series, new Set(), null)).toEqual([]);
  });

  it('drops hidden keys from the stacks the value axis fits', () => {
    expect(shownStacks([['a', 'b'], ['c']], new Set(['b', 'c']))).toEqual([['a'], []]);
  });
});

describe('AnalysisChartCardSkeleton', () => {
  it('draws one headline block per figure the card heads with', () => {
    const none = renderToStaticMarkup(<AnalysisChartCardSkeleton />);
    const two = renderToStaticMarkup(<AnalysisChartCardSkeleton headlines={2} />);
    const blocks = (html: string) => html.split('w-44').length - 1;
    expect(blocks(two) - blocks(none)).toBe(2);
  });
});

describe('AnalysisChartCard', () => {
  const chart = (filling: boolean) => ({
    filling,
    toggleFullscreen: () => {},
    closeFullscreen: () => {},
    chartRef: { current: null },
    chartHeight: undefined,
    viewportRef: { current: null },
    whole: true,
    canZoomIn: false,
    zoom: () => {},
    reset: () => {},
    zoomed: null,
    clickable: false,
    openDay: null,
    closeDay: () => {},
  });

  it('keeps the exit button when the chart gives way to a placeholder in full screen, so the page is never stuck', () => {
    const element = (filling: boolean) => (
      <AnalysisChartCard card={{ ...card, placeholder: <p>Loading again</p> }} chart={chart(filling)} legend={null} details={[]} currency="UZS">
        <svg />
      </AnalysisChartCard>
    );
    const filling = render(element(true));
    expect(filling).toContain('Loading again');
    expect(filling).toContain('aria-label="Exit full screen"');
    expect(filling).toContain('data-fullscreen="true"');
    // In the page, a placeholder card offers no full screen at all.
    expect(render(element(false))).not.toContain('full screen');
  });
});
