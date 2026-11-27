import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';
import { AppLocaleContext } from '@/components/i18n/AppLocaleContext';
import { DailySalesLineChart } from './DailySalesLineChart';
import { IncomeTrendChart } from './IncomeTrendChart';

// A static render has no layout to measure: draw the charts at a fixed size instead.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 640, height: 288 } as never),
  };
});

const render = (element: ReactElement) => renderToStaticMarkup(
  <AppLocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
    <NextIntlClientProvider locale="en" messages={messages}>{element}</NextIntlClientProvider>
  </AppLocaleContext.Provider>,
);

const trend = [
  { date: '1 Nov', iso: '2026-11-01', gameClubIncome: 1_000_000, barSales: 200_000, gameClubAverage: 1_000_000, barAverage: 200_000 },
  { date: '2 Nov', iso: '2026-11-02', gameClubIncome: 1_400_000, barSales: 400_000, gameClubAverage: 1_200_000, barAverage: 300_000 },
  { date: '3 Nov', iso: '2026-11-03', gameClubIncome: 1_600_000, barSales: 300_000, gameClubAverage: 1_333_333, barAverage: 300_000 },
];

const sales = [
  { date: '1 Nov', iso: '2026-11-01', gameClub: 1_000_000, playstation: 100_000, bar: 200_000 },
  { date: '2 Nov', iso: '2026-11-02', gameClub: 1_400_000, playstation: 150_000, bar: 400_000 },
  { date: '3 Nov', iso: '2026-11-03', gameClub: 1_600_000, playstation: 50_000, bar: null },
];

describe('IncomeTrendChart', () => {
  it('heads with each side\'s latest daily average and how it moved, never one summed figure', () => {
    const html = render(<IncomeTrendChart data={trend} />);
    expect(html).toContain('Game club daily average');
    expect(html).toContain('Bar daily average');
    expect(html).toContain('1 333 333');
    expect(html).toContain('+333 333 · +33.3%');
    expect(html).toContain('+100 000 · +50%');
    // The two sides' totals added together (4 000 000 + 900 000) appear nowhere.
    expect(html).not.toContain('4 900 000');
  });

  it('pins each average\'s latest value at the right end and offers full screen', () => {
    const html = render(<IncomeTrendChart data={trend} />);
    expect(html).toContain('>1.33m</text>');
    expect(html).toContain('>300k</text>');
    expect(html).toContain('aria-label="Open in full screen"');
  });
});

describe('DailySalesLineChart', () => {
  it('heads with the game club\'s and the bar\'s own totals, PlayStation folded into the game club', () => {
    const html = render(<DailySalesLineChart data={sales} />);
    expect(html).toContain('4 000 000');
    expect(html).toContain('600 000');
    expect(html).not.toContain('4 600 000');
    expect(html).not.toContain('Change in period');
  });

  it('labels each line\'s latest value, the bar at its last entry', () => {
    const html = render(<DailySalesLineChart data={sales} />);
    expect(html).toContain('>1.6m</text>');
    expect(html).toContain('>50k</text>');
    expect(html).toContain('>400k</text>');
  });
});
