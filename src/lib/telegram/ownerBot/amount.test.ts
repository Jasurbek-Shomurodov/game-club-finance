import { describe, expect, it } from 'vitest';
import { parseOwnerBotAmount } from './amount';

describe('parseOwnerBotAmount', () => {
  it('reads whole sums with spaces, dots or commas between thousands and an optional currency', () => {
    expect(parseOwnerBotAmount('500000')).toBe(500_000);
    expect(parseOwnerBotAmount(' 1 200 000 ')).toBe(1_200_000);
    expect(parseOwnerBotAmount('1 200 000')).toBe(1_200_000);
    expect(parseOwnerBotAmount('1.200.000')).toBe(1_200_000);
    expect(parseOwnerBotAmount('1,200,000')).toBe(1_200_000);
    expect(parseOwnerBotAmount('500 000 сум')).toBe(500_000);
    expect(parseOwnerBotAmount('500000 so\'m')).toBe(500_000);
    expect(parseOwnerBotAmount('0')).toBe(0);
  });

  it('refuses fractions, signs, words and numbers out of range', () => {
    for (const text of ['', 'сто', '1.5', '1,50', '12.34.567', '-500', '+500', '5e5', '500k', '1 200.000', 'abc 500', '10000000000000']) {
      expect(parseOwnerBotAmount(text), text).toBeNull();
    }
  });
});
