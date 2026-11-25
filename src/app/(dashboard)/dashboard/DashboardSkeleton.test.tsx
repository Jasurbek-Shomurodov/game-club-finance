import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';
import { DashboardSkeleton } from './DashboardSkeleton';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const club = vi.hoisted(() => ({ current: { selectedClubId: '', role: 'viewer', featureAccess: [] as string[] } }));
vi.mock('@/components/layout/DashboardShell', () => ({ useClub: () => club.current }));

const render = (node: ReactNode) => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={messages}>{node}</NextIntlClientProvider>,
);
/** The headline tiles: MetricGridSkeleton draws each as one card. */
const headlineTiles = (html: string) => (html.match(/class="rounded-2xl border border-gray-200 bg-surface p-5 shadow-card"/g) ?? []).length;

describe('DashboardSkeleton', () => {
  it('has the reserve tile for a member who can open the reserve', () => {
    const html = render(<DashboardSkeleton />);
    expect(headlineTiles(html)).toBe(5);
    expect(html).toContain('2xl:grid-cols-5');
  });

  it('has four tiles in the four-tile grid without the reserve', () => {
    const html = render(<DashboardSkeleton withReserve={false} />);
    expect(headlineTiles(html)).toBe(4);
    expect(html).toContain('2xl:grid-cols-4');
    expect(html).not.toContain('2xl:grid-cols-5');
  });
});

describe('DashboardRouteSkeleton', () => {
  it('follows the member: five tiles for an owner, four for a viewer, five before a club is known', async () => {
    const { DashboardRouteSkeleton } = await import('./DashboardRouteSkeleton');
    club.current = { selectedClubId: 'club-1', role: 'owner', featureAccess: [] };
    expect(headlineTiles(render(<DashboardRouteSkeleton />))).toBe(5);
    club.current = { selectedClubId: 'club-1', role: 'viewer', featureAccess: [] };
    expect(headlineTiles(render(<DashboardRouteSkeleton />))).toBe(4);
    club.current = { selectedClubId: '', role: 'viewer', featureAccess: [] };
    expect(headlineTiles(render(<DashboardRouteSkeleton />))).toBe(5);
  });
});
