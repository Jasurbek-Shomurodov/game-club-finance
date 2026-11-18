import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES, MANUAL_EXPENSE_CATEGORIES, isKnownExpenseCategory, isManualExpenseCategory } from './expenseCategories';

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

describe('investments', () => {
  it('is offered for every expense, not only the reserve', () => {
    expect(MANUAL_EXPENSE_CATEGORIES).toContain('investments');
  });
});
