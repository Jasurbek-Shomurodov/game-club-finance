import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '@/messages/en.json';
import type { RestockItem } from '@/lib/calculations/productSales';
import { DashboardAttention } from './DashboardAttention';

const cola: RestockItem = { id: 'cola', name: 'Coca cola 0,5', currentStock: 2, level: 'low', sold: 40, shortfall: 12, daysLeft: 1 };
const debtor = { name: 'Ali', remaining: 50_000, count: 2, oldestDate: '2026-11-02' };

function render(props: Partial<Parameters<typeof DashboardAttention>[0]>) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DashboardAttention lowStock={[cola]} debtors={[debtor]} loading={false} locale="en" currency="UZS" {...props} />
    </NextIntlClientProvider>,
  );
}

describe('DashboardAttention rows', () => {
  it('opens the purchase form on a running-low product and the debts of a person', () => {
    const html = render({ stockLink: { href: '/stock-purchase', label: 'Buy' }, debtsHref: '/debts' });
    expect(html).toContain('href="/stock-purchase?product=cola&amp;quantity=12"');
    expect(html).toContain('href="/debts?search=Ali"');
  });

  it('sends a product to the products page when purchases are not allowed', () => {
    const html = render({ stockLink: { href: '/products', label: 'Products' } });
    expect(html).toContain('href="/products"');
    expect(html).not.toContain('/debts');
  });

  it('keeps rows plain when there is nowhere to go', () => {
    const html = render({});
    expect(html).not.toContain('<a ');
    expect(html).toContain('Coca cola 0,5');
  });
});
