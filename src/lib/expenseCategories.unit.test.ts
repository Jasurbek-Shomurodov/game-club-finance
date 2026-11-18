import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES, MANUAL_EXPENSE_CATEGORIES, isCategoryAllowedForSource, isKnownExpenseCategory, isManualExpenseCategory, manualExpenseCategoriesFor } from './expenseCategories';

describe('expense categories', () => {
  it('keeps salary and other out of the manual list', () => {
    expect(MANUAL_EXPENSE_CATEGORIES).not.toContain('salary');
    expect(MANUAL_EXPENSE_CATEGORIES).not.toContain('other');
    expect(isManualExpenseCategory('salary')).toBe(false);
    expect(isManualExpenseCategory('rent')).toBe(true);
  });
  it('still recognises payroll expenses', () => {
    expect(EXPENSE_CATEGORIES).toContain('salary');
    expect(isKnownExpenseCategory('salary')).toBe(true);
    expect(isKnownExpenseCategory('other')).toBe(false);
  });
});

describe('reserve-only categories', () => {
  it('offers investments only when the reserve pays', () => {
    expect(manualExpenseCategoriesFor(true)).toContain('investments');
    expect(manualExpenseCategoriesFor(false)).not.toContain('investments');
    expect(manualExpenseCategoriesFor(false)).toContain('rent');
  });
  it('rejects investments paid from Game Club or Bar money', () => {
    expect(isCategoryAllowedForSource('investments', false)).toBe(false);
    expect(isCategoryAllowedForSource('investments', true)).toBe(true);
    expect(isCategoryAllowedForSource('rent', false)).toBe(true);
  });
});
