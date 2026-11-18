import { describe, expect, it } from 'vitest';
import { summarizeDebtors } from './dashboardAttention';

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
