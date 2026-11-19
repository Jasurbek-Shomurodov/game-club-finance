import { describe, expect, it } from 'vitest';
import {
  EXPENSE_CATEGORIES, MANUAL_EXPENSE_CATEGORIES, isExpenseCategoryAllowedForSource, isKnownExpenseCategory,
  isManualExpenseCategory, manualExpenseCategoriesFor,
} from './expenseCategories';

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

describe('categories by money source', () => {
  it('offers Bar money only cleaning', () => {
    expect(manualExpenseCategoriesFor('bar')).toEqual(['cleaning']);
    expect(isExpenseCategoryAllowedForSource('rent', 'bar')).toBe(false);
  });
  it('never offers food and drinks, which are bar purchases', () => {
    for (const source of ['game_club', 'bar', 'reserve'] as const) {
      expect(manualExpenseCategoriesFor(source)).not.toContain('food_drinks');
    }
  });
  it('offers Game Club money and the reserve everything else', () => {
    expect(manualExpenseCategoriesFor('game_club')).toContain('cleaning');
    expect(isExpenseCategoryAllowedForSource('rent', 'reserve')).toBe(true);
  });
});
