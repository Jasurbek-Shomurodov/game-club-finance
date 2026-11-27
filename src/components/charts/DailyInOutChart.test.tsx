import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';
import { DailyInOutChart } from './DailyInOutChart';
import { InOutChartSkeleton } from './ChartSkeletons';

// A static render has no layout to measure: draw the chart at a fixed size instead.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 640, height: 220 } as never),
  };
});

const render = (element: ReactElement) => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={messages}>{element}</NextIntlClientProvider>,
);

const days = [
  { date: '2026-11-01', label: '1 Nov', income: 1_000_000, expenses: 200_000 },
  { date: '2026-11-02', label: '2 Nov', income: 1_400_000, expenses: 400_000 },
  { date: '2026-11-04', label: '4 Nov', income: 600_000, expenses: 0 },
];

describe('DailyInOutChart', () => {
  it('names each series with its total over the bars shown and offers full screen, with no headline of its own', () => {
    const html = render(
      <DailyInOutChart data={days} incomeLabel="In" expensesLabel="Out" legendLabel="Day by day" currency="UZS" locale="en" onSelectDay={() => undefined} />,
    );
    expect(html).toContain('In 3 000 000 UZS, Out 600 000 UZS');
    expect(html).toContain('aria-label="Open in full screen"');
    // The page view draws no zoom controls and no figure of its own above the bars.
    expect(html).not.toContain('aria-label="Zoom in"');
    expect(html).not.toContain('Change in period');
  });

  it('opens days, but never hands a month to the host', () => {
    const daily = render(
      <DailyInOutChart data={days} incomeLabel="In" expensesLabel="Out" legendLabel="Day by day" currency="UZS" locale="en" onSelectDay={() => undefined} />,
    );
    expect(daily).toContain('cursor-pointer');
    const monthly = render(
      <DailyInOutChart
        data={[{ date: '2026-10', label: 'Oct', income: 1, expenses: 1 }, { date: '2026-11', label: 'Nov', income: 2, expenses: 1 }]}
        incomeLabel="Earned" expensesLabel="Paid" legendLabel="Payroll" currency="UZS" locale="en" onSelectDay={() => undefined}
      />,
    );
    expect(monthly).not.toContain('cursor-pointer');
  });

  it('keeps the shape its skeleton draws: legend pills, the full-screen button, then the bars', () => {
    const html = render(<InOutChartSkeleton bars={6} />);
    expect(html.match(/rounded-full/g)).toHaveLength(2);
    expect(html).toContain('h-10 w-10');
  });
});
