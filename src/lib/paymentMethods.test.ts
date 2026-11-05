import { describe, expect, it } from 'vitest';
import { defaultPaymentMethod, dollarExpenseAmount, expensePaymentMethods, normalizePaymentMethods } from './paymentMethods';

describe('payment method settings', () => {
  it('defaults legacy clubs to every supported method', () => {
    expect(normalizePaymentMethods(undefined)).toEqual(['terminal', 'cash', 'card']);
  });

  it('keeps valid methods in the application order and removes unknown values', () => {
    expect(normalizePaymentMethods(['card', 'cash', 'crypto'])).toEqual(['cash', 'card']);
  });

  it('never leaves a club without a usable method', () => {
    expect(normalizePaymentMethods([])).toEqual(['terminal', 'cash', 'card']);
    expect(defaultPaymentMethod(['card'])).toBe('card');
  });
});

describe('expensePaymentMethods', () => {
  it('adds PlayStation money and US dollars to Game Club expenses only', () => {
    expect(expensePaymentMethods(['cash'], 'game_club')).toEqual(['cash', 'playstation', 'usd']);
    expect(expensePaymentMethods(['cash'], 'bar')).toEqual(['cash']);
  });
});

describe('dollarExpenseAmount', () => {
  it('books dollars in whole sums at the rate', () => {
    expect(dollarExpenseAmount(100, 12_650.5)).toBe(1_265_050);
    expect(dollarExpenseAmount(0.1, 12_605)).toBe(1261);
    expect(dollarExpenseAmount(0, 12_600)).toBeNull();
    expect(dollarExpenseAmount(10, 0)).toBeNull();
    expect(dollarExpenseAmount(Number.NaN, 12_600)).toBeNull();
  });
});
