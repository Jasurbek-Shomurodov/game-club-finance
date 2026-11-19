import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';
import { ChangeHint, GlanceStat } from './GlanceStat';
import { ShareBar } from './ShareBar';
import { toDonutSlices } from './donutSlices';
import { StockGlance } from '@/app/(dashboard)/closing-stock/StockGlance';
import type { StockGlanceRow } from '@/lib/calculations/pageGlance';

vi.mock('@/components/i18n/AppLocaleContext', () => ({ useAppLocale: () => ({ locale: 'en' }) }));

const render = (element: ReactElement) => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={messages}>{element}</NextIntlClientProvider>,
);

describe('ShareBar', () => {
  it('names each positive part with its share and leaves out the rest', () => {
    const html = render(
      <ShareBar label="Pay" locale="en" currency="UZS" parts={[
        { key: 'a', label: 'Base', value: 300, color: 'red' },
        { key: 'b', label: 'KPI', value: 100, color: 'blue' },
        { key: 'c', label: 'Bonus', value: 0, color: 'green' },
      ]} />,
    );
    expect(html).toContain('aria-label="Pay: Base 75%, KPI 25%"');
    expect(html).not.toContain('Bonus');
    expect(html).toContain('300');
  });
  it('renders nothing without a positive part', () => {
    expect(render(<ShareBar label="Pay" locale="en" size="sm" parts={[{ key: 'a', label: 'A', value: 0, color: 'red' }]} />)).toBe('');
  });
});

describe('GlanceStat and ChangeHint', () => {
  it('prints the figure, its unit and hint', () => {
    const html = render(<GlanceStat label="Month" value="1 000" unit="UZS" hint="note" tone="warning" />);
    expect(html).toContain('text-warning-600');
    expect(html).toContain('UZS');
    expect(html).toContain('note');
  });
  it('colours a rise green, a fall red, and flips for costs', () => {
    expect(render(<ChangeHint ratio={0.2} label="vs last" locale="en" />)).toContain('text-success-600');
    expect(render(<ChangeHint ratio={-0.2} label="vs last" locale="en" />)).toContain('text-danger-600');
    expect(render(<ChangeHint ratio={0.2} label="vs last" locale="en" goodWhenUp={false} />)).toContain('text-danger-600');
    expect(render(<ChangeHint ratio={0} label="vs last" locale="en" />)).toContain('text-gray-600');
    expect(render(<ChangeHint ratio={null} label="vs last" locale="en" />)).toContain('vs last: —');
  });
});

describe('toDonutSlices', () => {
  it('colours in fixed order, folds the tail into grey other, and opens only named slices', () => {
    const select = vi.fn();
    const slices = toDonutSlices(
      Array.from({ length: 7 }, (_, index) => ({ key: `k${index}`, label: `L${index}`, value: 100 - index })),
      { key: 'other', label: 'Other' },
      select,
    );
    expect(slices).toHaveLength(5);
    expect(slices.at(-1)?.key).toBe('other');
    expect(slices.at(-1)?.onSelect).toBeUndefined();
    slices[0].onSelect?.();
    expect(select).toHaveBeenCalledWith('k0');
    expect(new Set(slices.map((slice) => slice.color)).size).toBe(5);
    expect(toDonutSlices([{ key: 'a', label: 'A', value: 1 }], { key: 'o', label: 'O' })[0].onSelect).toBeUndefined();
  });
});

describe('StockGlance', () => {
  const row = (id: string, closing: number, previous = 10): StockGlanceRow => ({
    id, name: `Product ${id}`, category: 'Drinks',
    input: { tracksInventory: true, previousStock: previous, addedToday: 0, closingStock: closing, soldQuantity: 0, salePrice: 10, costPrice: 4 },
  });

  it('counts what ran out or runs low and lists the best sellers', () => {
    const html = render(
      <StockGlance rows={[row('a', 0), row('b', 2), row('c', 8)]} stockValue={40} onFindProduct={() => undefined} onSelectCategory={() => undefined} />,
    );
    expect(html).toContain('1 out of stock');
    expect(html).toContain('1 running low');
    expect(html).toContain('Product a');
    expect(html).toContain('2 left');
    expect(html).toContain('Best sellers today');
  });
  it('says so when everything is in stock and nothing sold', () => {
    const html = render(<StockGlance rows={[row('c', 10)]} stockValue={40} onFindProduct={() => undefined} onSelectCategory={() => undefined} />);
    expect(html).toContain('Everything is in stock.');
    expect(html).toContain('Nothing sold on this day yet.');
  });
  it('renders nothing without products', () => {
    expect(render(<StockGlance rows={[]} stockValue={0} onFindProduct={() => undefined} onSelectCategory={() => undefined} />)).toBe('');
  });
});
