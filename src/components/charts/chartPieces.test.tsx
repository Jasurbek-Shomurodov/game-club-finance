import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Monitor, ShoppingBag } from 'lucide-react';
import messages from '@/messages/en.json';
import { ChartCard } from '@/components/dashboard/ChartCard';
import { ChartHeadline, ChartHeadlineSkeleton, headlineChangeParts } from './ChartHeadline';
import { DayDetailsList } from './ChartDayDetails';
import { ChartViewportTools, FullscreenToggle } from './ChartControls';
import { EndLabelTick, endLabelWidth, endLabelsFor } from './EndLabels';
import { distinctMoneyTick, endLabelMoney, formatAxisPrecise } from './chartLook';

const render = (element: ReactElement) => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={messages}>{element}</NextIntlClientProvider>,
);

describe('headlineChangeParts', () => {
  it('signs the amount and the share, green for a rise', () => {
    const parts = headlineChangeParts({ amount: 1_200_000, percent: 0.125 }, 'en');
    expect(parts.text).toBe('+1 200 000 · +12.5%');
    expect(parts.tone).toBe('success');
  });

  it('uses a real minus and red for a fall, and flips the tone for a cost', () => {
    const fall = headlineChangeParts({ amount: -300_000, percent: -0.25 }, 'en');
    expect(fall.text).toBe('−300 000 · −25%');
    expect(fall.tone).toBe('danger');
    expect(headlineChangeParts({ amount: 50_000, percent: 0.1 }, 'en', true).tone).toBe('danger');
  });

  it('drops the share when there is none, and stays grey when nothing moved', () => {
    expect(headlineChangeParts({ amount: 100, percent: null }, 'en').text).toBe('+100');
    const flat = headlineChangeParts({ amount: 0, percent: 0 }, 'en');
    expect(flat.text).toBe('0');
    expect(flat.tone).toBe('muted');
  });
});

describe('ChartHeadline', () => {
  it('shows the figure with its unit and the change in the period', () => {
    const html = render(
      <ChartHeadline label="Total" figure="4 500 000" unit="UZS" change={{ amount: 500_000, percent: 0.125 }} locale="en" />,
    );
    expect(html).toContain('Total');
    expect(html).toContain('4 500 000');
    expect(html).toContain('UZS');
    expect(html).toContain('+500 000 · +12.5%');
    expect(html).toContain('Change in period');
    expect(html).toContain('text-success-600');
  });

  it('has no change line without a change, and a skeleton of the same parts', () => {
    expect(render(<ChartHeadline figure="0" locale="en" />)).not.toContain('Change in period');
    expect(render(<ChartHeadlineSkeleton />).match(/skeleton/g)?.length).toBe(3);
  });
});

describe('DayDetailsList', () => {
  it('lists each side on its own row with its value, and says when a side has no entry', () => {
    const html = render(
      <DayDetailsList
        currency="UZS"
        rows={[
          { key: 'gameClub', label: 'Game Club', color: 'red', icon: Monitor, value: 1_500_000 },
          { key: 'bar', label: 'Bar', color: 'orange', icon: ShoppingBag, value: null },
          { key: 'share', label: 'Share', color: 'gray', dashed: true, value: 0.4, format: (value) => `${value * 100}%` },
        ]}
      />,
    );
    expect(html.match(/<li[ >]/g)).toHaveLength(3);
    expect(html).toContain('1 500 000');
    expect(html).toContain('No entry');
    expect(html).toContain('40%');
    expect(html).toContain('border-dashed');
    // Never a combined total of the game club and the bar.
    expect(html).not.toContain('3 000 000');
  });
});

describe('chart controls', () => {
  it('names the full-screen button for what it will do', () => {
    expect(render(<FullscreenToggle open={false} onToggle={() => undefined} />)).toContain('aria-label="Open in full screen"');
    const open = render(<FullscreenToggle open onToggle={() => undefined} />);
    expect(open).toContain('aria-label="Exit full screen"');
    expect(open).toContain('aria-pressed="true"');
  });

  it('disables zoom out and show all while every day is in view', () => {
    const html = render(<ChartViewportTools whole canZoomIn onZoom={() => undefined} onReset={() => undefined} />);
    expect(html).toContain('Drag to move through time, scroll to zoom');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    const zoomed = render(<ChartViewportTools whole={false} canZoomIn={false} onZoom={() => undefined} onReset={() => undefined} />);
    expect(zoomed.match(/disabled=""/g)).toHaveLength(1);
  });

  it('lets ChartCard carry a headline and fill the window', () => {
    const plain = render(<ChartCard title="Income">chart</ChartCard>);
    expect(plain).not.toContain('full screen');
    expect(plain).not.toContain('data-fullscreen');
    const filling = render(
      <ChartCard title="Income" headline={<ChartHeadline figure="10" locale="en" />} fullscreen={{ open: true, toggle: () => undefined }}>chart</ChartCard>,
    );
    expect(filling).toContain('data-fullscreen="true"');
    expect(filling).toContain('fixed inset-0');
    expect(filling).toContain('h-[100dvh]');
    expect(filling).toContain('Exit full screen');
    const inPage = render(<ChartCard title="Income" fullscreen={{ open: false, toggle: () => undefined }}>chart</ChartCard>);
    expect(inPage).toContain('Open in full screen');
    expect(inPage).not.toContain('fixed inset-0');
  });
});

describe('end labels and value ticks', () => {
  it('spreads each line’s latest value, skipping lines without one', () => {
    const labels = endLabelsFor(
      [{ value: 1000, color: 'a' }, { value: 990, color: 'b' }, { value: null, color: 'c' }],
      [0, 1000],
      240,
      (value) => String(value),
    );
    expect(labels).toEqual([{ at: 1000, color: 'a', text: '1000' }, { at: 900, color: 'b', text: '990' }]);
    expect(endLabelWidth([])).toBe(0);
    expect(endLabelWidth(labels)).toBe(Math.ceil(4 * 7.4 + 22));
  });

  it('draws a label as a pill only at its own tick', () => {
    const labels = [{ at: 5, text: '5K', color: 'rgb(var(--c-primary-600))' }];
    const svg = renderToStaticMarkup(<svg><EndLabelTick x={10} y={20} payload={{ value: 5 }} labels={labels} /></svg>);
    expect(svg).toContain('5K');
    expect(svg).toContain('rgb(var(--c-primary-600) / 0.14)');
    expect(renderToStaticMarkup(<svg><EndLabelTick x={10} y={20} payload={{ value: 6 }} labels={labels} /></svg>)).toBe('<svg></svg>');
  });

  it('keeps value ticks apart when compact labels would read the same', () => {
    expect(distinctMoneyTick([1_000_000, 2_000_000], 'en')(1_000_000)).toBe('1m');
    expect(distinctMoneyTick([1_400_000, 1_420_000], 'en')(1_420_000)).toBe('1.42m');
    expect(distinctMoneyTick([1_400_100, 1_400_200], 'en')(1_400_200)).toBe('1 400 200');
    expect(formatAxisPrecise(1_234_567, 'en')).toBe('1.23m');
    expect(endLabelMoney('en')(45_600)).toBe('45.6k');
  });
});
