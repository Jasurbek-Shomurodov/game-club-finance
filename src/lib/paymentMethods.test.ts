import { describe, expect, it } from 'vitest';
import { defaultPaymentMethod, expensePaymentMethods, normalizePaymentMethods } from './paymentMethods';

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
  it('adds PlayStation money to Game Club expenses only', () => {
    expect(expensePaymentMethods(['cash'], 'game_club')).toEqual(['cash', 'playstation']);
    expect(expensePaymentMethods(['cash'], 'bar')).toEqual(['cash']);
  });
});
