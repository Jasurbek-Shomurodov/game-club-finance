import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';

// Skeletons import parts of client components that read the router.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const routes = import.meta.glob<{ default: ComponentType }>('./*/loading.tsx', { eager: true });

const render = (Loading: ComponentType) => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={messages}><Loading /></NextIntlClientProvider>,
);

describe('route loading placeholders', () => {
  const entries = Object.entries(routes);

  it('covers every admin page that has its own layout', () => {
    const names = entries.map(([path]) => path.split('/')[1]);
    expect(names).toEqual(expect.arrayContaining([
      'dashboard', 'financial-analysis', 'daily-cash', 'closing-stock', 'write-offs', 'stock-purchase', 'products',
      'promotions', 'reports', 'daily-report', 'monthly-report', 'money-taken', 'reserve', 'debts', 'salaries',
      'team', 'history', 'settings', 'game-club-money-details', 'bar-money-details',
    ]));
  });

  it.each(entries)('%s announces loading once and shimmers', (_path, route) => {
    const html = render(route.default);
    // One "Loading…" status for the whole page; its parts stay silent.
    expect(html).toMatch(/^<div[^>]*role="status"[^>]*aria-label="Loading/);
    expect(html).toContain('class="skeleton ');
    // The shimmer replaced the old pulse everywhere.
    expect(html).not.toContain('animate-pulse');
  });
});
