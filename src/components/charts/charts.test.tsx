import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Monitor } from 'lucide-react';
import messages from '@/messages/en.json';
import { averageByWeekday } from '@/lib/calculations/insights';
import { SideGlanceCard, SideGlanceCardSkeleton } from '@/components/dashboard/SideGlanceCard';
import { SideScorecard } from '@/components/financial-analysis/AnalysisSections';
import { BalanceFlowChart, formatFlowAxis, nextSelectionKey, visibleBarHeight, type BalanceFlowRow } from './BalanceFlowChart';
import { BalanceFlowChartSkeleton } from './ChartSkeletons';
import { CalendarHeatmap } from './CalendarHeatmap';
import { DonutBreakdown } from './DonutBreakdown';
import { RadialMeter } from './RadialMeter';
import { WeekdayBars } from './WeekdayBars';
import { formatPercentShare, weekdayShortNames } from './chartFormat';

// The glance card opens pages from chart segments; a static render has no app router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

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

  it('lets a day without data be opened up to the selectable date', () => {
    const html = render(
      <CalendarHeatmap yearMonth="2026-11" values={new Map([['2026-11-02', 1000]])} through="2026-11-02" today="2026-11-01"
        color="rgb(var(--c-primary-600))" currency="UZS" locale="en" legendLow="Less" legendHigh="More"
        onSelectDay={() => undefined} selectableThrough="2026-11-03" />,
    );
    // 1 and 2 have data; 3 is today, still without an entry, and stays reachable.
    expect(html.match(/<button/g)).toHaveLength(3);
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

describe('BalanceFlowChart', () => {
  const rows = [
    { key: '2026-11-01', label: '1 Nov', tooltipLabel: '1 November 2026', held: 500, income: 500, expenses: 0 },
    { key: '2026-11-02', label: '2 Nov', tooltipLabel: '2 November 2026', held: 500, income: 0, expenses: 0 },
    { key: '2026-11-03', label: '3 Nov', tooltipLabel: '3 November 2026', held: 300, income: 0, expenses: 200 },
  ];
  const chart = (selectedKey: string | null) => render(
    <BalanceFlowChart rows={rows} selectedKey={selectedKey} onSelect={() => undefined} heldLabel="Held" incomeLabel="Put in"
      expensesLabel="Taken out" legendLabel="Money in and out" summary="Last 30 days: held 300 UZS" currency="UZS" locale="en" initialWidth={600} />,
  );
  const flowChart = (flowRows: BalanceFlowRow[]) => render(
    <BalanceFlowChart rows={flowRows} selectedKey={null} onSelect={() => undefined} heldLabel="Held" incomeLabel="Put in" expensesLabel="Taken out"
      legendLabel="Money in and out" summary="Last 30 days" currency="UZS" locale="en" initialWidth={600} />,
  );
  /** The lower (flow) plot: its zero line, its bars and its y tick labels. */
  const flowPlot = (html: string) => {
    const plot = html.slice(html.lastIndexOf('class="recharts-surface"'));
    const number = (tag: string, name: string) => Number(tag.match(new RegExp(`\\s${name}="(-?[\\d.]+)"`))?.[1]);
    const zero = number(plot.match(/<line[^>]*class="recharts-reference-line-line"[^>]*>/)?.[0] ?? '', 'y1');
    const bars = [...plot.matchAll(/<path[^>]*class="recharts-rectangle"[^>]*>/g)].map(([tag]) => ({
      side: tag.includes('--c-success-500') ? 'in' : 'out',
      y: number(tag, 'y'),
      height: number(tag, 'height'),
      // Where each rounded corner ends, top to bottom.
      arcs: [...(tag.match(/\sd="([^"]*)"/)?.[1] ?? '').matchAll(/A\s*[\d.]+,[\d.]+,0,0,[01],\s*-?[\d.]+,(-?[\d.]+)/g)].map((match) => Number(match[1])),
    }));
    const yAxis = plot.slice(plot.indexOf('recharts-yAxis'), plot.indexOf('recharts-bar'));
    const ticks = [...yAxis.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((match) => match[1]);
    return { zero, bars, ticks };
  };
  const day = (key: string, income: number, expenses: number): BalanceFlowRow => ({ key, label: key, tooltipLabel: key, held: 1_000, income, expenses });

  it('draws both plots in one focusable group named by its summary, with the in/out legend', () => {
    const html = chart(null);
    expect(html).toContain('role="group" aria-label="Last 30 days: held 300 UZS" tabindex="0"');
    expect(html).toContain('aria-label="Money in and out"');
    expect(html.match(/class="recharts-surface"/g)).toHaveLength(2);
    // Days that moved carry a dot on the balance line; the quiet day does not.
    expect(html.match(/<circle[^>]*r="2.5"/g)).toHaveLength(2);
    // Only the zero line of the flow plot: no column is marked.
    expect(html.match(/recharts-reference-line-line/g)).toHaveLength(1);
    expect(html).not.toContain('stroke-dasharray="4 3"');
    expect(html).not.toContain('recharts-reference-dot');
  });

  it('puts put in above and taken out below one zero line, in the same column, with amounts on the axis', () => {
    const { zero, bars, ticks } = flowPlot(chart(null));
    expect(Number.isFinite(zero)).toBe(true);
    expect(bars).toHaveLength(2);
    const putIn = bars.find((bar) => bar.side === 'in');
    const takenOut = bars.find((bar) => bar.side === 'out');
    // Put in rises to the line; taken out is drawn from its far end back up to the line.
    expect(putIn?.height).toBeGreaterThan(0);
    expect((putIn?.y ?? 0) + (putIn?.height ?? 0)).toBeCloseTo(zero);
    expect(takenOut?.height).toBeLessThan(0);
    expect(takenOut?.y).toBeGreaterThan(zero);
    expect((takenOut?.y ?? 0) + (takenOut?.height ?? 0)).toBeCloseTo(zero);
    // One shared scale: 200 taken out is shorter than 500 put in.
    expect(Math.abs(takenOut?.height ?? 0)).toBeLessThan(putIn?.height ?? 0);
    // The axis reads 500 / 0 / 500, never a minus amount.
    expect(ticks).toEqual(['500', '0', '500']);
    expect(formatFlowAxis(-1_500_000, 'en')).toBe(formatFlowAxis(1_500_000, 'en'));
  });

  it('rounds each bar at the end away from the zero line', () => {
    const { zero, bars } = flowPlot(chart(null));
    for (const bar of bars) {
      expect(bar.arcs.length).toBeGreaterThan(0);
      for (const arcY of bar.arcs) {
        expect(Math.abs(arcY - bar.y)).toBeLessThanOrEqual(3);
        expect(Math.abs(arcY - zero)).toBeGreaterThan(3);
      }
    }
  });

  it('draws at least 3px on both sides for any movement and nothing for an empty bucket', () => {
    // A huge deposit beside a one-sum withdrawal, a quiet day, and a tiny deposit beside a huge withdrawal.
    const { zero, bars } = flowPlot(flowChart([day('a', 5_000_000, 1), day('b', 0, 0), day('c', 1, 5_000_000)]));
    expect(bars).toHaveLength(4);
    const heights = bars.map((bar) => bar.height);
    expect(Math.min(...heights.filter((height) => height > 0))).toBe(3);
    expect(Math.max(...heights.filter((height) => height < 0))).toBe(-3);
    // The small bars grow away from the line on their own side.
    for (const bar of bars) expect(bar.y + bar.height).toBeCloseTo(zero);
    expect(bars.filter((bar) => bar.side === 'out').every((bar) => bar.y > zero)).toBe(true);
    expect(bars.filter((bar) => bar.side === 'in').every((bar) => bar.y < zero)).toBe(true);
  });

  it('draws no taken-out bar on top of a put in when nothing was taken out', () => {
    // Only deposits: the zero line sits at the foot of the plot and every bar is above it.
    const { zero, bars, ticks } = flowPlot(flowChart([day('a', 500, 0), day('b', 0, 0), day('c', 300, 0)]));
    expect(bars.map((bar) => bar.side)).toEqual(['in', 'in']);
    for (const bar of bars) expect(bar.y + bar.height).toBeCloseTo(zero);
    expect(ticks[0]).toBe('0');
  });

  it('keeps the legend to the two series names, without totals', () => {
    const html = chart(null);
    expect(html).toContain('>Put in</span>');
    expect(html).toContain('>Taken out</span>');
    expect(html).not.toContain('tabular-nums font-semibold');
  });

  it('floors a visible bar for any movement and nothing for a bucket without one', () => {
    expect(visibleBarHeight(1)).toBe(3);
    expect(visibleBarHeight(5_000_000)).toBe(3);
    expect(visibleBarHeight(0)).toBe(0);
    expect(visibleBarHeight(undefined)).toBe(0);
  });

  it('marks the selected column in both plots and dims the other bars', () => {
    const html = chart('2026-11-03');
    expect(html).toContain('data-selected="2026-11-03"');
    // The dashed marker in both plots, beside the flow plot's zero line.
    expect(html.match(/stroke-dasharray="4 3"/g)).toHaveLength(2);
    expect(html.match(/recharts-reference-line-line/g)).toHaveLength(3);
    expect(html).toContain('recharts-reference-dot');
    expect(html).toContain('fill-opacity="0.3"');
  });

  it('moves the selection with the arrow keys and clears it with Escape', () => {
    const keys = rows.map((row) => row.key);
    expect(nextSelectionKey(keys, null, 'ArrowLeft')).toBe('2026-11-03');
    expect(nextSelectionKey(keys, null, 'ArrowRight')).toBe('2026-11-03');
    expect(nextSelectionKey(keys, '2026-11-03', 'ArrowLeft')).toBe('2026-11-02');
    expect(nextSelectionKey(keys, '2026-11-01', 'ArrowLeft')).toBe('2026-11-01');
    expect(nextSelectionKey(keys, '2026-11-02', 'ArrowRight')).toBe('2026-11-03');
    expect(nextSelectionKey(keys, '2026-11-02', 'Home')).toBe('2026-11-01');
    expect(nextSelectionKey(keys, '2026-11-02', 'End')).toBe('2026-11-03');
    expect(nextSelectionKey(keys, '2026-11-02', 'Escape')).toBeNull();
    // Nothing to clear, another key, or nothing to select: the key is left alone.
    expect(nextSelectionKey(keys, null, 'Escape')).toBeUndefined();
    expect(nextSelectionKey(keys, '2026-11-02', 'Enter')).toBeUndefined();
    expect(nextSelectionKey([], null, 'ArrowLeft')).toBeUndefined();
  });
});

describe('SideGlanceCard', () => {
  it('shows the best and weakest day, the margin and where the income went', () => {
    const html = render(
      <SideGlanceCard side="game_club" title="Game Club" icon={Monitor} iconClassName="" color="red" yearMonth="2026-11"
        range={{ from: '2026-11-01', to: '2026-11-30' }} through="2026-11-03" today="2026-11-03"
        values={new Map([['2026-11-01', 100], ['2026-11-02', 300], ['2026-11-03', 0]])}
        income={400} profit={100} spending={[{ key: 'rent', label: 'Rent', value: 300 }]} currency="UZS" locale="en" />,
    );
    expect(html).toContain('Best day');
    expect(html).toContain('300');
    expect(html).toContain('Margin: 25%');
    expect(html).toContain('Profit kept');
  });

  it('keeps the true income in the donut centre in a loss month', () => {
    const html = render(
      <SideGlanceCard side="game_club" title="Game Club" icon={Monitor} iconClassName="" color="red" yearMonth="2026-11"
        range={{ from: '2026-11-01', to: '2026-11-30' }} through="2026-11-03" today="2026-11-03"
        values={new Map([['2026-11-01', 400]])}
        income={400} profit={-200} spending={[{ key: 'rent', label: 'Rent', value: 600 }]} currency="UZS" locale="en" />,
    );
    // The centre is the income, not the 600 that was spent; rent took 150% of it.
    expect(html).toMatch(/Income<\/span><span[^>]*>400<\/span>/);
    expect(html).toContain('>150%<');
    expect(html).not.toContain('Profit kept');
  });

  it('links its heading, days and expense slices only to pages the viewer may open', () => {
    const card = (links?: { moneyDetails?: boolean; dailyReport?: boolean; reports?: boolean }) => render(
      <SideGlanceCard side="bar" title="Bar" icon={Monitor} iconClassName="" color="red" yearMonth="2026-11"
        range={{ from: '2026-11-01', to: '2026-11-30' }} through="2026-11-03" today="2026-11-03"
        values={new Map([['2026-11-01', 400]])} links={links}
        income={400} profit={100} spending={[{ key: 'barCost', label: 'Goods', value: 200 }, { key: 'rent', label: 'Rent', value: 100 }]} currency="UZS" locale="en" />,
    );
    const plain = card();
    expect(plain).not.toContain('<a ');
    expect(plain).not.toContain('<button');
    const linked = card({ moneyDetails: true, dailyReport: true, reports: true });
    expect(linked).toContain('href="/bar-money-details?from=2026-11-01&amp;to=2026-11-30"');
    // The three days counted so far, and only the expense category (not goods cost or profit) has a list behind it.
    expect(linked.match(/<button/g)).toHaveLength(4);
  });

  it('says so when nothing was spent or kept', () => {
    const html = render(
      <SideGlanceCard side="bar" title="Bar" icon={Monitor} iconClassName="" color="red" yearMonth="2026-11"
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
    expect(html).toContain('+100%');
  });

  it('draws no split and dashes when there was no income', () => {
    const html = render(
      <SideScorecard title="Bar" icon={Monitor} iconClassName="" color="red" incomeLabel="Bar sales"
        now={{ income: 0, spent: 0, left: 0, marginPct: null, averageDailyIncome: 0 }}
        loading={false} currency="UZS" locale="en"
        labels={{ spent: 'Spent', profit: 'Profit', margin: 'Margin', perDay: 'Per day', kept: 'Kept' }} />,
    );
    expect(html).toContain('aria-label="Spent —, Kept —"');
    expect(html).not.toContain('Kept · 100%');
    expect(html).not.toContain('bg-danger-500/80 transition-[width]');
  });
});

describe('skeletons follow the new layouts', () => {
  it('shows the scorecard skeleton while a scorecard loads', () => {
    const html = render(
      <SideScorecard title="Bar" icon={Monitor} iconClassName="" color="red" incomeLabel="Bar sales"
        now={{ income: 0, spent: 0, left: 0, marginPct: null, averageDailyIncome: 0 }}
        loading currency="UZS" locale="en" labels={{ spent: 'Spent', profit: 'Profit', margin: 'Margin', perDay: 'Per day', kept: 'Kept' }} />,
    );
    expect(html).toContain('skeleton');
    expect(html).not.toContain('Bar sales');
  });

  it('draws the glance card skeleton with a full calendar and seven weekday bars', () => {
    const html = render(<SideGlanceCardSkeleton />);
    expect(html.match(/h-8 bg-gray-100/g)).toHaveLength(35);
    expect(html.match(/flex-1 rounded-b-sm/g)).toHaveLength(7);
  });

  it('draws the balance flow skeleton with bars above and below a zero line at the flow plot height', () => {
    const html = render(<BalanceFlowChartSkeleton bars={6} />);
    expect(html).toContain('height:112px');
    expect(html.match(/flex-1 rounded-b-none rounded-t/g)).toHaveLength(6);
    expect(html.match(/flex-1 rounded-t-none rounded-b/g)).toHaveLength(6);
    expect(html).toContain('h-px w-full');
  });
});
