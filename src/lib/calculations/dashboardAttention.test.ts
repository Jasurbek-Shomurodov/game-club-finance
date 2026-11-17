import { describe, expect, it } from 'vitest';
import { buildDashboardTodayStatus, summarizeDebtors } from './dashboardAttention';

const debt = (person_name: string | null, remaining_amount: number | string | null, date: string, status = 'unpaid') => ({ person_name, remaining_amount, date, status });

describe('summarizeDebtors', () => {
  it('groups one person\'s open debts and puts the largest balance first', () => {
    expect(summarizeDebtors([
      debt('Aziz', 50_000, '2026-11-03'),
      debt('Bek', 120_000, '2026-11-05', 'partial'),
      debt(' aziz ', '30000', '2026-10-28'),
    ])).toEqual([
      { name: 'Bek', remaining: 120_000, count: 1, oldestDate: '2026-11-05' },
      { name: 'Aziz', remaining: 80_000, count: 2, oldestDate: '2026-10-28' },
    ]);
  });

  it('leaves out paid debts and debts with nothing left', () => {
    expect(summarizeDebtors([
      debt('Aziz', 50_000, '2026-11-03', 'paid'),
      debt('Bek', 0, '2026-11-03'),
      debt('Vali', null, '2026-11-03'),
    ])).toEqual([]);
  });

  it('breaks equal balances by the older debt, then by name', () => {
    expect(summarizeDebtors([
      debt('Vali', 10_000, '2026-11-02'),
      debt('Aziz', 10_000, '2026-11-02'),
      debt('Bek', 10_000, '2026-11-01'),
    ]).map((debtor) => debtor.name)).toEqual(['Bek', 'Aziz', 'Vali']);
  });

  it('keeps nameless debts together under an empty name', () => {
    expect(summarizeDebtors([debt(null, 5_000, '2026-11-02'), debt('  ', 7_000, '2026-11-01')])).toEqual([
      { name: '', remaining: 12_000, count: 2, oldestDate: '2026-11-01' },
    ]);
  });
});

describe('buildDashboardTodayStatus', () => {
  const trend = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((date, index) => ({
    date, gameClubIncome: (index + 1) * 1000, barSales: (index + 1) * 100,
  }));

  it('reports today\'s entries and figures', () => {
    expect(buildDashboardTodayStatus({
      trend, cashEntryDates: ['2026-11-04', '2026-11-05'], stockEntryDates: ['2026-11-04'], businessToday: '2026-11-05',
    })).toEqual({
      cashEntered: true, stockSaved: false, gameClubIncome: 5000, barSales: 500, missingCashDates: [], missingStockDates: [],
    });
  });

  it('lists skipped days after the first entry, never today or later days', () => {
    const status = buildDashboardTodayStatus({
      trend, cashEntryDates: ['2026-11-02', '2026-11-04'], stockEntryDates: ['2026-11-01'], businessToday: '2026-11-05',
    });
    expect(status.cashEntered).toBe(false);
    expect(status.missingCashDates).toEqual(['2026-11-03']);
    expect(status.missingStockDates).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
  });

  it('has no gaps before the first entry or when nothing was entered yet', () => {
    const status = buildDashboardTodayStatus({ trend, cashEntryDates: ['2026-11-04'], stockEntryDates: [], businessToday: '2026-11-05' });
    expect(status.missingCashDates).toEqual([]);
    expect(status.missingStockDates).toEqual([]);
  });

  it('reads zero for a business date outside the period', () => {
    expect(buildDashboardTodayStatus({ trend: [], cashEntryDates: [], stockEntryDates: [], businessToday: '2026-12-01' })).toEqual({
      cashEntered: false, stockSaved: false, gameClubIncome: 0, barSales: 0, missingCashDates: [], missingStockDates: [],
    });
  });
});
