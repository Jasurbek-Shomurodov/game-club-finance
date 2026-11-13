import { describe, expect, it } from 'vitest';
import {
  dollarsForMonth,
  exchangeFlowByMethod,
  exchangeNetByMethod,
  exchangeReceivedAmount,
  heldDollars,
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

  it('reports the UZS moved into dollars in a month and the dollars still held', () => {
    const rows = [
      row({ date: '2026-09-05', from_method: 'cash', to_method: 'usd', from_amount: 12_000_000, to_amount: 1000, rate: 12_000 }),
      row({ date: '2026-10-02', from_method: 'cash', to_method: 'usd', from_amount: '6000000', to_amount: '480', rate: '12500' }),
      row({ date: '2026-10-20', from_method: 'usd', to_method: 'terminal', from_amount: 100, to_amount: 1_300_000, rate: 13_000 }),
      row({ date: '2026-10-21', from_method: 'cash', to_method: 'card', from_amount: 999, to_amount: 999 }),
      row({ date: '2026-11-01', from_method: 'cash', to_method: 'usd', from_amount: 1_300_000, to_amount: 100, rate: 13_000 }),
    ];

    expect(dollarsForMonth(rows, '2026-09')).toEqual({ usd: 1000, uzs: 12_000_000, heldUsd: 1000 });
    expect(dollarsForMonth(rows, '2026-10')).toEqual({ usd: 380, uzs: 4_700_000, heldUsd: 1380 });
    expect(dollarsForMonth(rows, '2026-08')).toEqual({ usd: 0, uzs: 0, heldUsd: 0 });
    // A month with no exchanges still knows what earlier months left in dollars.
    expect(dollarsForMonth(rows.slice(0, 1), '2026-12')).toEqual({ usd: 0, uzs: 0, heldUsd: 1000 });
  });

  it('takes dollars spent by expenses out of the dollars held, at their own rate in sums', () => {
    const exchanges = [
      row({ date: '2026-09-05', from_method: 'cash', to_method: 'usd', from_amount: 12_000_000, to_amount: 1000, rate: 12_000 }),
    ];
    const expenses = [
      { date: '2026-10-03', amount: 1_260_000, payment_method: 'usd', usd_amount: '100' },
      { date: '2026-10-04', amount: 50_000, payment_method: 'cash' },
      { date: '2026-11-01', amount: 630_000, payment_method: 'usd', usd_amount: 50 },
    ];
    expect(heldDollars(exchanges, expenses)).toBe(850);
    expect(heldDollars(exchanges)).toBe(1000);
    expect(dollarsForMonth(exchanges, '2026-10', expenses)).toEqual({ usd: -100, uzs: -1_260_000, heldUsd: 900 });
    expect(dollarsForMonth(exchanges, '2026-09', expenses)).toEqual({ usd: 1000, uzs: 12_000_000, heldUsd: 1000 });
  });

  it('nets each method, keeping dollars apart', () => {
    expect(exchangeNetByMethod([
      row({ from_method: 'cash', to_method: 'card', from_amount: 300, to_amount: 300 }),
      row({ from_method: 'card', to_method: 'usd', from_amount: '12650', to_amount: '1', rate: '12650' }),
      row({ from_method: 'usd', to_method: 'terminal', from_amount: 0.1, to_amount: 1265, rate: 12650 }),
      row({ from_method: 'usd', to_method: 'terminal', from_amount: 0.2, to_amount: 2530, rate: 12650 }),
    ])).toEqual({ cash: -300, terminal: 3795, card: 300 - 12650, usd: 0.7 });
  });

  it('splits each method into positive amounts received and given', () => {
    expect(exchangeFlowByMethod([
      row({ from_method: 'cash', to_method: 'card', from_amount: 300, to_amount: 300 }),
      row({ from_method: 'card', to_method: 'cash', from_amount: '100', to_amount: '100' }),
      row({ from_method: 'cash', to_method: 'usd', from_amount: 12650, to_amount: 1, rate: 12650 }),
    ])).toEqual({
      cash: { in: 100, out: 12_950 },
      terminal: { in: 0, out: 0 },
      card: { in: 300, out: 100 },
      usd: { in: 1, out: 0 },
    });
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
