import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Monitor } from 'lucide-react';
import messages from '@/messages/en.json';
import { averageByWeekday } from '@/lib/calculations/insights';
import { SideGlanceCard, SideGlanceCardSkeleton } from '@/components/dashboard/SideGlanceCard';
import { SideScorecard } from '@/components/financial-analysis/AnalysisSections';
import { CalendarHeatmap } from './CalendarHeatmap';
import { DonutBreakdown } from './DonutBreakdown';
import { RadialMeter } from './RadialMeter';
import { WeekdayBars } from './WeekdayBars';
import { formatPercentShare, weekdayShortNames } from './chartFormat';

const render = (element: ReactElement) => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={messages}>{element}</NextIntlClientProvider>,
);

describe('chart formatting', () => {
  it('prints shares as whole percents and weekdays Monday first', () => {
    expect(formatPercentShare(0.425, 'en')).toBe('43%');
    expect(formatPercentShare(Number.NaN, 'en')).toBe('0%');
    expect(weekdayShortNames('en')[0]).toBe('Mon');
    expect(weekdayShortNames('en')).toHaveLength(7);
  });
});

describe('RadialMeter', () => {
  it('names its reading and clamps the ring', () => {
    const html = render(<RadialMeter value={1.5} color="red" label="Margin 150%">x</RadialMeter>);
    expect(html).toContain('aria-label="Margin 150%"');
    expect(html).toContain('stroke-dashoffset="0"');
  });
});

describe('CalendarHeatmap', () => {
  it('names every day with its amount and outlines the days still ahead', () => {
    const html = render(
      <CalendarHeatmap yearMonth="2026-11" values={new Map([['2026-11-02', 1000]])} through="2026-11-02" today="2026-11-02"
        color="rgb(var(--c-primary-600))" currency="UZS" locale="en" legendLow="Less" legendHigh="More" onSelectDay={() => undefined} />,
    );
    expect(html).toContain('1 000 UZS');
    expect(html).toContain('border-dashed');
    // Only the days with data can be opened.
    expect(html.match(/<button/g)).toHaveLength(2);
  });
});

describe('WeekdayBars', () => {
  it('labels the strongest weekday', () => {
    const data = averageByWeekday(new Map([['2026-11-07', 900]]), { from: '2026-11-02', through: '2026-11-08' });
    const html = render(<WeekdayBars data={data} color="red" currency="UZS" locale="en" averageLabel="Average" />);
    expect(html).toContain('Average · Sat: 900 UZS');
  });
});

describe('DonutBreakdown', () => {
  it('lists each slice with its amount and share, as a button when it opens something', () => {
    const html = render(
      <DonutBreakdown total={300} totalLabel="Income" currency="UZS" locale="en" slices={[
        { key: 'a', label: 'Rent', value: 200, share: 2 / 3, color: 'red', onSelect: () => undefined },
        { key: 'b', label: 'Cleaning', value: 100, share: 1 / 3, color: 'blue' },
      ]} />,
    );
    expect(html).toContain('aria-label="Rent: 200 UZS, 67%"');
    expect(html).toContain('Cleaning');
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

describe('SideGlanceCard', () => {
  it('shows the best and weakest day, the margin and where the income went', () => {
    const html = render(
      <SideGlanceCard title="Game Club" icon={Monitor} iconClassName="" color="red" yearMonth="2026-11"
        range={{ from: '2026-11-01', to: '2026-11-30' }} through="2026-11-03" today="2026-11-03"
        values={new Map([['2026-11-01', 100], ['2026-11-02', 300], ['2026-11-03', 0]])}
        income={400} profit={100} spending={[{ key: 'rent', label: 'Rent', value: 300 }]} currency="UZS" locale="en" />,
    );
    expect(html).toContain('Best day');
    expect(html).toContain('300');
    expect(html).toContain('Margin: 25%');
    expect(html).toContain('Profit kept');
  });

  it('says so when nothing was spent or kept', () => {
    const html = render(
      <SideGlanceCard title="Bar" icon={Monitor} iconClassName="" color="red" yearMonth="2026-11"
        range={{ from: '2026-11-01', to: '2026-11-30' }} through={null} today="2026-11-03"
        values={new Map()} income={0} profit={0} spending={[]} currency="UZS" locale="en" />,
    );
    expect(html).toContain('No expenses for this period');
    expect(html).toContain('Margin: —');
  });
});

describe('SideScorecard', () => {
  it('splits income into spent and kept and links each figure', () => {
    const html = render(
      <SideScorecard title="Game Club" icon={Monitor} iconClassName="" color="red" incomeLabel="Money in"
        now={{ income: 1000, spent: 600, left: 400, marginPct: 40, averageDailyIncome: 50 }}
        before={{ income: 500, spent: 600, left: -100, marginPct: null, averageDailyIncome: 25 }}
        compare={(now, before) => ({ value: before ? Math.round(((now - before) / Math.abs(before)) * 100) : null, label: 'vs previous' })}
        loading={false} currency="UZS" locale="en" detailsHref="/details" spentHref="/spent"
        labels={{ spent: 'Spent', profit: 'Profit', margin: 'Margin', perDay: 'Per day', kept: 'Kept' }} />,
    );
    expect(html).toContain('aria-label="Spent 60%, Kept 40%"');
    expect(html).toContain('href="/spent"');
    expect(html).toContain('100%');
  });
});

describe('skeletons follow the new layouts', () => {
  it('shows the scorecard skeleton while a scorecard loads', () => {
    const html = render(
      <SideScorecard title="Bar" icon={Monitor} iconClassName="" color="red" incomeLabel="Bar sales"
        now={{ income: 0, spent: 0, left: 0, marginPct: null, averageDailyIncome: 0 }}
        loading currency="UZS" locale="en" labels={{ spent: 'Spent', profit: 'Profit', margin: 'Margin', perDay: 'Per day', kept: 'Kept' }} />,
    );
    expect(html).toContain('animate-pulse');
    expect(html).not.toContain('Bar sales');
  });

  it('draws the glance card skeleton with a full calendar and seven weekday bars', () => {
    const html = render(<SideGlanceCardSkeleton />);
    expect(html.match(/h-8 bg-gray-100/g)).toHaveLength(35);
    expect(html.match(/flex-1 rounded-b-sm/g)).toHaveLength(7);
  });
});
