import { describe, it, expect } from 'vitest';
import {
  calculateRemainingDebt, canManageDebts, classifyDebtPaymentInsertError, debtAgeDays, debtPersonKey, getDebtStatus,
  latestPaymentDateByDebt, openDebtsByPerson, sortOpenDebts,
} from './debt';

describe('calculateRemainingDebt', () => {
  it('returns difference between amount and paid', () => {
    expect(calculateRemainingDebt(100000, 30000)).toBe(70000);
  });

  it('returns 0 when fully paid', () => {
    expect(calculateRemainingDebt(100000, 100000)).toBe(0);
  });

  it('returns 0 when overpaid (clamps to 0)', () => {
    expect(calculateRemainingDebt(100000, 120000)).toBe(0);
  });

  it('new debt has remaining equal to full amount', () => {
    expect(calculateRemainingDebt(500000, 0)).toBe(500000);
  });

  it('partial payment reduces remaining correctly', () => {
    expect(calculateRemainingDebt(500000, 200000)).toBe(300000);
  });

  it('remaining cannot go below zero (overpayment clamps)', () => {
    expect(calculateRemainingDebt(500000, 600000)).toBe(0);
  });
});

describe('getDebtStatus', () => {
  it('returns unpaid when nothing paid', () => {
    expect(getDebtStatus(100000, 0)).toBe('unpaid');
  });

  it('returns partial when partially paid', () => {
    expect(getDebtStatus(100000, 50000)).toBe('partial');
  });

  it('returns paid when fully paid', () => {
    expect(getDebtStatus(100000, 100000)).toBe('paid');
  });

  it('returns paid when overpaid', () => {
    expect(getDebtStatus(100000, 120000)).toBe('paid');
  });
});

describe('canManageDebts', () => {
  it('allows owners and admins to change the debt ledger', () => {
    expect(canManageDebts('owner')).toBe(true);
    expect(canManageDebts('admin')).toBe(true);
  });

  it('keeps viewers and unknown roles read-only', () => {
    expect(canManageDebts('viewer')).toBe(false);
    expect(canManageDebts(null)).toBe(false);
  });
});

describe('classifyDebtPaymentInsertError', () => {
  it('recognizes an overpayment rejected by the database', () => {
    expect(classifyDebtPaymentInsertError({ code: '23514', message: 'Payment (500) exceeds remaining debt (100)' }))
      .toBe('exceeds_remaining');
    expect(classifyDebtPaymentInsertError({
      code: '23514',
      message: 'new row for relation "new_debts" violates check constraint "new_debts_paid_amount_valid"',
    })).toBe('exceeds_remaining');
  });

  it('separates date violations from overpayments', () => {
    expect(classifyDebtPaymentInsertError({ code: '23514', message: 'Debt payment date cannot be earlier than the debt date' }))
      .toBe('before_debt_date');
    expect(classifyDebtPaymentInsertError({ code: '22007', message: 'Debt payments cannot use a future business date' }))
      .toBe('future_date');
  });

  it('treats anything else as a generic failure', () => {
    expect(classifyDebtPaymentInsertError({ code: '23514', message: 'some other check' })).toBe('other');
    expect(classifyDebtPaymentInsertError({ code: '42501', message: 'permission denied' })).toBe('other');
    expect(classifyDebtPaymentInsertError(null)).toBe('other');
  });
});

describe('latestPaymentDateByDebt', () => {
  it('keeps the latest payment date per debt regardless of order', () => {
    expect(latestPaymentDateByDebt([
      { debt_id: 'a', date: '2026-07-20' },
      { debt_id: 'b', date: '2026-07-05' },
      { debt_id: 'a', date: '2026-08-02' },
      { debt_id: 'a', date: '2026-07-25' },
    ])).toEqual({ a: '2026-08-02', b: '2026-07-05' });
  });

  it('returns an empty map without payments', () => {
    expect(latestPaymentDateByDebt([])).toEqual({});
  });
});

describe('debtAgeDays', () => {
  it('counts whole days to the business date, across months and years', () => {
    expect(debtAgeDays('2026-11-17', '2026-11-17')).toBe(0);
    expect(debtAgeDays('2026-11-16', '2026-11-17')).toBe(1);
    expect(debtAgeDays('2026-10-17', '2026-11-17')).toBe(31);
    expect(debtAgeDays('2025-12-31', '2026-01-01')).toBe(1);
    expect(debtAgeDays('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('is never negative or NaN', () => {
    expect(debtAgeDays('2026-11-20', '2026-11-17')).toBe(0);
    expect(debtAgeDays('', '2026-11-17')).toBe(0);
  });
});

describe('sortOpenDebts', () => {
  const debts = [
    { id: 'a', date: '2026-11-10', amount: 100, paid_amount: 0 },
    { id: 'b', date: '2026-11-05', amount: 500, paid_amount: 450 },
    { id: 'c', date: '2026-10-01', amount: 300, paid_amount: 0 },
    { id: 'd', date: '2026-11-05', amount: 100, paid_amount: 0 },
  ];
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id).join('');

  it('keeps the read order for newest and never changes the input', () => {
    const sorted = sortOpenDebts(debts, 'newest');
    expect(ids(sorted)).toBe('abcd');
    expect(sorted).not.toBe(debts);
  });

  it('puts the largest remaining balance first, not the largest original amount', () => {
    expect(ids(sortOpenDebts(debts, 'largest'))).toBe('cadb');
  });

  it('puts the oldest first and keeps the read order within a date', () => {
    expect(ids(sortOpenDebts(debts, 'oldest'))).toBe('cbda');
    expect(ids(debts)).toBe('abcd');
  });
});

describe('openDebtsByPerson', () => {
  it('adds up a person under every spelling and leaves settled debts out', () => {
    const totals = openDebtsByPerson([
      { id: 1, person_name: 'Ali  Valiyev', date: '2026-11-01', amount: 100, paid_amount: 20 },
      { id: 2, person_name: ' ali valiyev ', date: '2026-11-02', amount: '50', paid_amount: '0' },
      { id: 3, person_name: 'Ali Valiyev', date: '2026-11-03', amount: 70, paid_amount: 70 },
      { id: 4, person_name: 'Bek', date: '2026-11-03', amount: 10, paid_amount: 0 },
      { id: 5, person_name: null, date: '2026-11-03', amount: 5, paid_amount: 0 },
    ]);
    expect(totals.get(debtPersonKey('ALI VALIYEV'))).toEqual({ remaining: 130, count: 2 });
    expect(totals.get(debtPersonKey('Bek'))).toEqual({ remaining: 10, count: 1 });
    expect(totals.get('')).toEqual({ remaining: 5, count: 1 });
    expect(totals.size).toBe(3);
  });
});
