import { describe, expect, it } from 'vitest';
import {
  exchangeNetByMethod,
  exchangeReceivedAmount,
  withExchangesByMonth,
  type MoneyExchangeRow,
} from './moneyExchanges';

const row = (overrides: Partial<MoneyExchangeRow>): MoneyExchangeRow => ({
  id: 'x', date: '2026-10-10', from_method: 'cash', to_method: 'card', from_amount: 100, to_amount: 100, rate: null, ...overrides,
});

describe('money exchanges', () => {
  it('converts like record_money_exchange', () => {
    expect(exchangeReceivedAmount('cash', 'card', 500_000, null)).toBe(500_000);
    expect(exchangeReceivedAmount('cash', 'usd', 1_000_000, 12_650)).toBe(79.05);
    expect(exchangeReceivedAmount('usd', 'terminal', 100, 12_650.5)).toBe(1_265_050);
    expect(exchangeReceivedAmount('cash', 'usd', 1_000_000, null)).toBeNull();
    expect(exchangeReceivedAmount('cash', 'cash', 1, null)).toBeNull();
    expect(exchangeReceivedAmount('cash', 'card', 0, null)).toBeNull();
  });

  it('nets each method, keeping dollars apart', () => {
    expect(exchangeNetByMethod([
      row({ from_method: 'cash', to_method: 'card', from_amount: 300, to_amount: 300 }),
      row({ from_method: 'card', to_method: 'usd', from_amount: '12650', to_amount: '1', rate: '12650' }),
      row({ from_method: 'usd', to_method: 'terminal', from_amount: 0.1, to_amount: 1265, rate: 12650 }),
      row({ from_method: 'usd', to_method: 'terminal', from_amount: 0.2, to_amount: 2530, rate: 12650 }),
    ])).toEqual({ cash: -300, terminal: 3795, card: 300 - 12650, usd: 0.7 });
  });

  it('adds exchanges to the month they are dated in', () => {
    const balances = { '2026-10': { cash: 1000, terminal: 0, card: 0, playstation: 50 } };
    expect(withExchangesByMonth(balances, [
      row({ date: '2026-10-02', from_method: 'cash', to_method: 'terminal', from_amount: 400, to_amount: 400 }),
      row({ date: '2026-11-01', from_method: 'card', to_method: 'cash', from_amount: 10, to_amount: 10 }),
    ])).toEqual({
      '2026-10': { cash: 600, terminal: 400, card: 0, playstation: 50 },
      '2026-11': { cash: 10, terminal: 0, card: -10, playstation: 0 },
    });
    expect(balances['2026-10'].cash).toBe(1000);
  });
});
