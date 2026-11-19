import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLocaleContext } from '@/components/i18n/AppLocaleContext';
import messages from '@/messages/en.json';
import type { StockWriteOffCountRow } from '@/lib/stockWriteOffs';
import { StockAdjustmentsLedger } from './StockAdjustmentsLedger';

const query = vi.hoisted(() => ({ data: [] as unknown[], loading: false, error: false }));
// The ledger's data comes from one club query; a static render reads it from here.
vi.mock('@/lib/useClubQuery', () => ({
  useClubQuery: () => ({ ...query, refreshing: false, reload: async () => undefined, setData: () => undefined }),
}));

const rows: StockWriteOffCountRow[] = [
  { date: '2026-11-12', product_id: 'coke', adjustment_quantity: -2, adjustment_reason: 'shortage', cost_price: 6_000, products: { name: 'Coke' } },
  { date: '2026-11-13', product_id: 'milk', adjustment_quantity: -3, adjustment_reason: 'expired: sour', cost_price: 4_000, products: { name: 'Milk' } },
  { date: '2026-11-13', product_id: 'tea', adjustment_quantity: 5, adjustment_reason: 'correction: recount', cost_price: 3_000, products: { name: 'Tea' } },
];

function render(showCost: boolean) {
  return renderToStaticMarkup(
    <AppLocaleContext.Provider value={{ locale: 'en', setLocale: () => undefined }}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <StockAdjustmentsLedger clubId="club-1" from="2026-11-01" to="2026-11-30" showCost={showCost} />
      </NextIntlClientProvider>
    </AppLocaleContext.Provider>,
  );
}

describe('StockAdjustmentsLedger', () => {
  beforeEach(() => {
    Object.assign(query, { data: rows, loading: false, error: false });
  });

  it('shows the owner what was written off and what was found, at cost', () => {
    const html = render(true);
    // 2 × 6 000 + 3 × 4 000 written off; 5 × 3 000 found.
    expect(html).toContain('24 000');
    expect(html).toContain('15 000');
    expect(html).toContain('Corrections (found)');
    expect(html).toContain('Value at cost');
    // Corrections are listed with the write-offs, each with its reason and note.
    for (const text of ['Coke', 'Milk', 'Tea', 'Shortage', 'Expired', 'Correction', 'sour', 'recount']) expect(html).toContain(text);
    // Every figure is a filter and every product a shortcut.
    expect(html.match(/<button/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it('shows everyone else units only', () => {
    const html = render(false);
    expect(html).not.toContain('Value at cost');
    expect(html).not.toContain('24 000');
    expect(html).toContain('5 pcs');
    expect(html).toContain('+5 pcs');
  });

  it('says so when the period has no adjustments', () => {
    query.data = [];
    const html = render(true);
    expect(html).toContain('No write-offs or corrections in this period');
    expect(html).not.toContain('+0');
  });

  it('keeps the layout while loading and offers a retry when the load fails', () => {
    query.loading = true;
    expect(render(true)).toContain('class="skeleton ');
    Object.assign(query, { loading: false, error: true });
    const html = render(true);
    expect(html).toContain('Write-offs and corrections could not be loaded.');
    expect(html).toContain('Retry');
  });
});
