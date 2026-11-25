import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { PackageMinus } from 'lucide-react';
import messages from '@/messages/en.json';
import { AmountCard, MetricCard, StatTile } from './MetricCard';

const render = (element: ReactElement) => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={messages}>{element}</NextIntlClientProvider>,
);

describe('tappable cards', () => {
  it('renders a figure with a link as a link to its details', () => {
    const html = render(<MetricCard label="Total loss" value="726 046" href="/reports?view=writeOffs" />);
    expect(html).toMatch(/^<a [^>]*href="\/reports\?view=writeOffs"/);
    expect(html).toContain('Total loss');
  });

  it('renders a figure with an action as a button', () => {
    const html = render(<StatTile label="Shortage" value="0" onClick={() => undefined} />);
    expect(html).toMatch(/^<button type="button"/);
  });

  it('keeps a figure without a target a plain box', () => {
    const html = render(<MetricCard label="Expired" value="0" />);
    expect(html).toMatch(/^<div /);
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<button');
  });

  it('links an amount card', () => {
    const html = render(<AmountCard label="Bar sales" amount={1_000_000} icon={PackageMinus} href="/bar-money-details?from=2026-11-01" />);
    expect(html).toMatch(/^<a [^>]*href="\/bar-money-details/);
    expect(html).toContain('1');
  });

  it('shows an unknown amount as a muted dash, never as 0', () => {
    const html = render(<AmountCard label="In the reserve" amount={null} icon={PackageMinus} sparkline={[1, 2, 3]} />);
    expect(html).toContain('—');
    expect(html).toContain('text-gray-500');
    expect(html).not.toContain('opacity="0.12"');
    expect(html).not.toMatch(/>0</);
  });
});
