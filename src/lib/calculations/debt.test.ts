import { describe, it, expect } from 'vitest';
import { calculateRemainingDebt, canManageDebts, classifyDebtPaymentInsertError, getDebtStatus, latestPaymentDateByDebt } from './debt';

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
