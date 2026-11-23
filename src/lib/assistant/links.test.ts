import { describe, expect, it } from 'vitest';
import type { MoneyCheck } from '@/lib/calculations/moneyChecks';
import type { UpcomingPayments } from '@/lib/calculations/upcomingPayments';
import type { DataTable } from './datasets';
import { datasetLinks, MAX_LINKS, moneyCheckLinks, outlookLinks, upcomingLinks, type LinkAccess } from './links';
import { internalHref } from './markdownLinks';

const owner: LinkAccess = { role: 'owner', featureAccess: null, businessToday: '2026-11-24' };
const period = { from: '2026-11-01', to: '2026-11-24' };
const table = (dataset: DataTable['dataset'], rows: DataTable['rows'] = []): DataTable => ({ dataset, columns: [], rows });

describe('datasetLinks', () => {
  it('links a summary to the month, its reports and both money details', () => {
    expect(datasetLinks({ dataset: 'summary', table: table('summary'), period }, owner).map((link) => link.href)).toEqual([
      '/financial-analysis?month=2026-11',
      '/reports?from=2026-11-01&to=2026-11-24',
      '/game-club-money-details?from=2026-11-01&to=2026-11-24',
      '/bar-money-details?from=2026-11-01&to=2026-11-24',
    ]);
  });

  it('only offers pages the member may open', () => {
    const reportsOnly: LinkAccess = { role: 'admin', featureAccess: ['assistant', 'reports'], businessToday: '2026-11-24' };
    expect(datasetLinks({ dataset: 'summary', table: table('summary'), period }, reportsOnly).map((link) => link.href)).toEqual([
      '/reports?from=2026-11-01&to=2026-11-24',
    ]);
    const debtsOnly: LinkAccess = { role: 'admin', featureAccess: ['assistant'], businessToday: '2026-11-24' };
    expect(datasetLinks({ dataset: 'debts', table: table('debts') }, debtsOnly)).toEqual([]);
  });

  it('links each category and each day of a short period', () => {
    const categories = datasetLinks({ dataset: 'categories', table: table('categories', [{ category: 'rent' }, { category: 'salary' }]), period }, owner);
    expect(categories.map((link) => link.href)).toEqual([
      '/reports?from=2026-11-01&to=2026-11-24&category=expense',
      '/reports?from=2026-11-01&to=2026-11-24&category=expense%3Arent',
      '/reports?from=2026-11-01&to=2026-11-24&category=expense%3Asalary',
    ]);
    const daily = datasetLinks({ dataset: 'daily', table: table('daily', [{ date: '2026-11-01' }, { date: '2026-11-02' }]), period }, owner);
    expect(daily.map((link) => link.href)).toContain('/daily-report?date=2026-11-02');
  });

  it('caps the list and builds only hrefs the reply renderer accepts as internal', () => {
    const months = Array.from({ length: 60 }, (_, index) => ({ month: `20${20 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}` }));
    const links = datasetLinks({ dataset: 'monthly', table: table('monthly', months) }, owner);
    expect(links).toHaveLength(MAX_LINKS);
    for (const link of links) expect(internalHref(link.href)).toBe(link.href);
  });
});

describe('moneyCheckLinks', () => {
  const duplicate: MoneyCheck = {
    kind: 'duplicate_expense', severity: 'danger', side: 'bar', date: '2026-11-03',
    range: { from: '2026-11-03', to: '2026-11-03' }, category: 'rent', amount: 500_000, count: 2,
  };
  const lowDay: MoneyCheck = {
    kind: 'low_income_day', severity: 'warning', side: 'game_club', date: '2026-11-02',
    range: { from: '2026-11-02', to: '2026-11-02' }, amount: 300_000, usual: 900_000,
  };

  it('opens each check where Financial Analysis opens it', () => {
    expect(moneyCheckLinks([duplicate, lowDay], '2026-11', owner).map((link) => link.href)).toEqual([
      '/financial-analysis?month=2026-11',
      '/reports?from=2026-11-03&to=2026-11-03&category=expense%3Arent&source=bar',
      '/daily-report?date=2026-11-02',
    ]);
  });

  it('leaves out checks whose page the member cannot open', () => {
    const dashboardOnly: LinkAccess = { role: 'admin', featureAccess: ['assistant', 'dashboard'], businessToday: '2026-11-24' };
    expect(moneyCheckLinks([duplicate, lowDay], '2026-11', dashboardOnly).map((link) => link.href)).toEqual([
      '/financial-analysis?month=2026-11',
    ]);
  });
});

describe('upcomingLinks', () => {
  it('links the plans and each plan\'s expenses for the month', () => {
    const upcoming: UpcomingPayments = {
      gameClub: {
        remaining: 1_000_000,
        rows: [{
          preset: { id: 'p1', name: 'Rent', category: 'rent', payment_source: 'game_club', payment_method: null, monthly_amount: 1_000_000, sort_order: 0, archived_at: null },
          remaining: 1_000_000, usualDay: 5, dueDate: '2026-11-05', overdue: true,
        }],
      },
      bar: { remaining: 0, rows: [] },
    };
    const range = { from: '2026-11-01', to: '2026-11-30' };
    expect(upcomingLinks(upcoming, range, owner).map((link) => link.href)).toEqual([
      '/financial-analysis?month=2026-11',
      '/reports?from=2026-11-01&to=2026-11-30&category=expense%3Arent&source=game_club',
    ]);
    expect(upcomingLinks(null, range, owner)).toHaveLength(1);
  });
});

describe('outlookLinks', () => {
  it('links the forecast, money and, with the reserve row, the reserve ledger', () => {
    expect(outlookLinks(period, owner, { ownerProfit: true, reserve: true }).map((link) => link.href)).toEqual([
      '/financial-analysis?month=2026-11',
      '/reports?from=2026-11-01&to=2026-11-24&category=money_in',
      '/reports?from=2026-11-01&to=2026-11-24&category=expense',
      '/game-club-money-details?from=2026-11-01&to=2026-11-24',
      '/bar-money-details?from=2026-11-01&to=2026-11-24',
      '/money-taken',
      '/reserve?view=history',
    ]);
    const without = outlookLinks(period, owner, { ownerProfit: false, reserve: false }).map((link) => link.href);
    expect(without).not.toContain('/reserve?view=history');
    expect(without).not.toContain('/money-taken');
  });

  it('never offers the reserve to a member who may not open it', () => {
    const admin: LinkAccess = { role: 'admin', featureAccess: ['assistant', 'dashboard'], businessToday: '2026-11-24' };
    const hrefs = outlookLinks(period, admin, { ownerProfit: true, reserve: true }).map((link) => link.href);
    expect(hrefs).not.toContain('/money-taken');
    expect(hrefs).toContain('/financial-analysis?month=2026-11');
    expect(hrefs).not.toContain('/reserve?view=history');
    expect(hrefs.some((href) => href.startsWith('/reports'))).toBe(false);
  });
});
