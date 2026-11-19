import { describe, it, expect } from 'vitest';
import {
  safeRedirectPath,
  validateDate,
  validateDebtPayment,
  getDebtDateIssue,
} from './index';

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
