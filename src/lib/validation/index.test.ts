import { describe, it, expect } from 'vitest';
import {
  classifyDatabaseWriteError,
  safeRedirectPath,
  validateAmount,
  validateQuantity,
  validateDate,
  validateClosingStock,
  validateDebtPayment,
  getDebtDateIssue,
  validateEditWindow,
  validateAll,
} from './index';

describe('validateAmount', () => {
  it('passes for positive numbers', () => {
    expect(validateAmount(120000).valid).toBe(true);
  });
  it('fails for zero', () => {
    expect(validateAmount(0).valid).toBe(false);
  });
  it('fails for negative', () => {
    expect(validateAmount(-500).valid).toBe(false);
  });
  it('fails for non-numeric', () => {
    expect(validateAmount('abc').valid).toBe(false);
  });
});

describe('validateQuantity', () => {
  it('passes for zero', () => {
    expect(validateQuantity(0).valid).toBe(true);
  });
  it('passes for positive', () => {
    expect(validateQuantity(10).valid).toBe(true);
  });
  it('fails for negative', () => {
    expect(validateQuantity(-1).valid).toBe(false);
  });
});

describe('validateDate', () => {
  it('passes for valid ISO date', () => {
    expect(validateDate('2026-06-03').valid).toBe(true);
  });
  it('fails for wrong format', () => {
    expect(validateDate('03/06/2026').valid).toBe(false);
  });
  it('fails for invalid date', () => {
    expect(validateDate('2026-13-99').valid).toBe(false);
    expect(validateDate('2026-02-30').valid).toBe(false);
  });
  it('fails for non-string', () => {
    expect(validateDate(null).valid).toBe(false);
  });
});

describe('validateClosingStock', () => {
  it('passes when closing stock is within range', () => {
    expect(validateClosingStock({ previousStock: 100, addedToday: 20, closingStock: 90 }).valid).toBe(true);
  });
  it('fails when closing stock exceeds previous + added without confirmation', () => {
    const result = validateClosingStock({ previousStock: 100, addedToday: 20, closingStock: 125 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('120');
  });
  it('passes when closing stock exceeds with explicit confirmation', () => {
    expect(
      validateClosingStock({ previousStock: 100, addedToday: 20, closingStock: 125, confirmAdjustment: true }).valid,
    ).toBe(true);
  });
  it('passes when closing stock equals previous + added (nothing sold)', () => {
    expect(validateClosingStock({ previousStock: 100, addedToday: 20, closingStock: 120 }).valid).toBe(true);
  });
});

describe('validateDebtPayment', () => {
  it('passes when payment is within remaining balance', () => {
    expect(validateDebtPayment({ paymentAmount: 200000, remainingDebt: 500000 }).valid).toBe(true);
  });
  it('passes when payment equals remaining balance exactly', () => {
    expect(validateDebtPayment({ paymentAmount: 500000, remainingDebt: 500000 }).valid).toBe(true);
  });
  it('fails when payment exceeds remaining debt', () => {
    const result = validateDebtPayment({ paymentAmount: 600000, remainingDebt: 500000 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Overpayment');
  });
  it('fails when payment is zero or negative', () => {
    expect(validateDebtPayment({ paymentAmount: 0, remainingDebt: 500000 }).valid).toBe(false);
  });
});

describe('getDebtDateIssue', () => {
  it('accepts a debt or payment on the current business date', () => {
    expect(getDebtDateIssue({ date: '2026-08-27', businessDate: '2026-08-27' })).toBeNull();
  });

  it('rejects dates after the current business date', () => {
    expect(getDebtDateIssue({ date: '2026-08-28', businessDate: '2026-08-27' })).toBe('future');
  });

  it('rejects a payment before its debt originated', () => {
    expect(
      getDebtDateIssue({
        date: '2026-08-20',
        debtDate: '2026-08-21',
        businessDate: '2026-08-27',
      }),
    ).toBe('before_debt');
  });

  it('rejects malformed dates', () => {
    expect(getDebtDateIssue({ date: '27/08/2026', businessDate: '2026-08-27' })).toBe('invalid');
  });
});

describe('validateEditWindow', () => {
  const createdAt = '2026-06-03T10:00:00.000Z';

  it('always allows owner to edit', () => {
    const farFuture = new Date('2026-12-31T23:59:59Z');
    expect(validateEditWindow({ createdAt, now: farFuture, role: 'owner' }).valid).toBe(true);
  });
  it('allows admin within 15 minutes', () => {
    const within = new Date('2026-06-03T10:10:00.000Z');
    expect(validateEditWindow({ createdAt, now: within, role: 'admin' }).valid).toBe(true);
  });
  it('blocks admin after 15 minutes', () => {
    const after = new Date('2026-06-03T10:16:00.000Z');
    const result = validateEditWindow({ createdAt, now: after, role: 'admin' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('locked');
  });
  it('blocks viewer regardless', () => {
    const within = new Date('2026-06-03T10:05:00.000Z');
    expect(validateEditWindow({ createdAt, now: within, role: 'viewer' }).valid).toBe(false);
  });
});

describe('validateAll', () => {
  it('returns ok when all pass', () => {
    expect(validateAll({ valid: true }, { valid: true }).valid).toBe(true);
  });
  it('returns first failure', () => {
    const result = validateAll({ valid: true }, { valid: false, error: 'bad' }, { valid: false, error: 'worse' });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('bad');
  });
});

describe('classifyDatabaseWriteError', () => {
  it('maps insufficient privilege to permission', () => {
    expect(classifyDatabaseWriteError({ code: '42501', message: 'Salary editing access is required.' })).toBe('permission');
  });
  it('maps check violations to check', () => {
    expect(classifyDatabaseWriteError({ code: '23514', message: 'violates check constraint' })).toBe('check');
  });
  it('treats anything else as unknown', () => {
    expect(classifyDatabaseWriteError({ code: 'P0001', message: 'Invalid salary entry.' })).toBe('unknown');
    expect(classifyDatabaseWriteError(new Error('network'))).toBe('unknown');
    expect(classifyDatabaseWriteError(null)).toBe('unknown');
    expect(classifyDatabaseWriteError('boom')).toBe('unknown');
  });
});

describe('safeRedirectPath', () => {
  it('keeps same-origin paths with their query string', () => {
    expect(safeRedirectPath('/daily-cash')).toBe('/daily-cash');
    expect(safeRedirectPath('/reports?month=2026-09&tab=1')).toBe('/reports?month=2026-09&tab=1');
    expect(safeRedirectPath('/salaries/employees/abc')).toBe('/salaries/employees/abc');
  });
  it('rejects empty and non-path values', () => {
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath('')).toBeNull();
    expect(safeRedirectPath('daily-cash')).toBeNull();
  });
  it('rejects absolute and protocol-relative URLs', () => {
    expect(safeRedirectPath('https://evil.example/')).toBeNull();
    expect(safeRedirectPath('//evil.example/path')).toBeNull();
    expect(safeRedirectPath('/\\evil.example')).toBeNull();
    expect(safeRedirectPath('/\tevil')).toBeNull();
    expect(safeRedirectPath('javascript:alert(1)')).toBeNull();
  });
  it('rejects paths that normalize into a protocol-relative URL', () => {
    expect(safeRedirectPath('/.//evil.com')).toBeNull();
    expect(safeRedirectPath('/a/..//evil.com')).toBeNull();
    expect(safeRedirectPath('/%2e//evil.com')).toBeNull();
    expect(safeRedirectPath('/..//evil.com/x?y=1')).toBeNull();
  });
  it('rejects control characters', () => {
    expect(safeRedirectPath('/\n/evil.example')).toBeNull();
    expect(safeRedirectPath('/\t/evil.example')).toBeNull();
  });
  it('refuses to loop back into the login flow', () => {
    expect(safeRedirectPath('/login')).toBeNull();
    expect(safeRedirectPath('/login?next=/x')).toBeNull();
    expect(safeRedirectPath('/auth/callback?code=1')).toBeNull();
  });
});
