import { describe, expect, it } from 'vitest';
import {
  dollarsForMonth,
  exchangeFlowByMethod,
  exchangeNeedsRate,
  exchangeNetByMethod,
  exchangeReceivedAmount,
  heldDollars,
  isExchangeMethod,
  withExchangesByMonth,
  type MoneyExchangeRow,
} from './moneyExchanges';
import { defaultPaymentMethod, dollarExpenseAmount, expensePaymentMethods, normalizePaymentMethods } from '../paymentMethods';

const exchange = (id: string, date: string, from: MoneyExchangeRow['from_method'], to: MoneyExchangeRow['to_method'], fromAmount: number | string, toAmount: number | string): MoneyExchangeRow => ({
  id, date, from_method: from, to_method: to, from_amount: fromAmount, to_amount: toAmount, rate: from === 'usd' || to === 'usd' ? 13_000 : null,
});

describe('exchangeReceivedAmount', () => {
  it('moves UZS between methods unchanged and needs no rate', () => {
    expect(exchangeNeedsRate('cash', 'card')).toBe(false);
    expect(exchangeReceivedAmount('cash', 'card', 250_000, null)).toBe(250_000);
  });

  it('buys dollars to the cent and sells them for whole sums', () => {
    expect(exchangeNeedsRate('cash', 'usd')).toBe(true);
    expect(exchangeNeedsRate('usd', 'terminal')).toBe(true);
    expect(exchangeReceivedAmount('cash', 'usd', 1_280_000, 12_800)).toBe(100);
    // 1 000 000 / 12 650 = 79.0513...
    expect(exchangeReceivedAmount('card', 'usd', 1_000_000, 12_650)).toBe(79.05);
    // 100.5 x 12 650 = 1 271 325.
    expect(exchangeReceivedAmount('usd', 'cash', 100.5, 12_650)).toBe(1_271_325);
  });

  it('refuses an exchange that would receive nothing', () => {
    // 50 sums is under half a cent.
    expect(exchangeReceivedAmount('cash', 'usd', 50, 12_800)).toBeNull();
    expect(exchangeReceivedAmount('usd', 'cash', 0.00001, 12_800)).toBeNull();
  });

  it('refuses the same method, a non-positive amount, or a dollar exchange without a usable rate', () => {
    expect(exchangeReceivedAmount('cash', 'cash', 1_000, null)).toBeNull();
    expect(exchangeReceivedAmount('cash', 'card', 0, null)).toBeNull();
    expect(exchangeReceivedAmount('cash', 'card', -5, null)).toBeNull();
    expect(exchangeReceivedAmount('cash', 'card', Number.NaN, null)).toBeNull();
    expect(exchangeReceivedAmount('cash', 'usd', 1_000_000, null)).toBeNull();
    expect(exchangeReceivedAmount('cash', 'usd', 1_000_000, 0)).toBeNull();
    expect(exchangeReceivedAmount('usd', 'cash', 100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('isExchangeMethod', () => {
  it('accepts the club methods and dollars only', () => {
    for (const method of ['cash', 'terminal', 'card', 'usd']) expect(isExchangeMethod(method)).toBe(true);
    // PlayStation money cannot be exchanged.
    for (const value of ['playstation', 'bank', '', null, undefined, 5]) expect(isExchangeMethod(value)).toBe(false);
  });
});

describe('exchange totals per method', () => {
  const rows = [
    exchange('x1', '2026-10-01', 'cash', 'card', '300000', '300000'),
    exchange('x2', '2026-10-02', 'cash', 'usd', 1_300_000, '100.10'),
    exchange('x3', '2026-10-03', 'usd', 'terminal', '30.20', 392_600),
    // A row whose amounts were not read moves nothing.
    exchange('x4', '2026-10-04', 'card', 'cash', null as never, null as never),
  ];

  it('reports what each method gave and received as positive amounts', () => {
    expect(exchangeFlowByMethod(rows)).toEqual({
      cash: { in: 0, out: 1_600_000 },
      terminal: { in: 392_600, out: 0 },
      card: { in: 300_000, out: 0 },
      usd: { in: 100.1, out: 30.2 },
    });
  });

  it('nets each method: exchanged in minus exchanged out, dollars to the cent', () => {
    expect(exchangeNetByMethod(rows)).toEqual({ cash: -1_600_000, terminal: 392_600, card: 300_000, usd: 69.9 });
    // UZS is conserved between UZS methods: the cash-to-card move nets to zero across the two.
    expect(exchangeNetByMethod([rows[0]])).toEqual({ cash: -300_000, terminal: 0, card: 300_000, usd: 0 });
  });
});

describe('dollars held', () => {
  const exchanges = [
    exchange('sep', '2026-09-10', 'cash', 'usd', 1_280_000, 100),
    exchange('oct-buy', '2026-10-05', 'card', 'usd', 650_000, 50),
    exchange('oct-sell', '2026-10-20', 'usd', 'cash', 30, 390_000),
    exchange('oct-move', '2026-10-21', 'cash', 'terminal', 111_000, 111_000),
    exchange('nov', '2026-11-02', 'cash', 'usd', 130_000, 10),
  ];
  const expenses = [
    { date: '2026-09-15', amount: 256_000, payment_method: 'usd', usd_amount: 20 },
    { date: '2026-10-07', amount: '520000', payment_method: 'usd', usd_amount: '40' },
    { date: '2026-10-08', amount: 999_000, payment_method: 'cash', usd_amount: null },
    { date: '2026-11-03', amount: 65_000, payment_method: 'usd', usd_amount: 5 },
  ];

  it('holds bought minus sold minus spent', () => {
    // 100 + 50 - 30 + 10 bought and sold = 130; 20 + 40 + 5 spent.
    expect(heldDollars(exchanges)).toBe(130);
    expect(heldDollars(exchanges, expenses)).toBe(65);
  });

  it('spends no dollars for a dollar expense read without its dollar amount', () => {
    expect(heldDollars(exchanges, [{ date: '2026-10-07', amount: 520_000, payment_method: 'usd' }, { date: '2026-10-08', amount: 1, payment_method: 'usd', usd_amount: null }])).toBe(130);
    const october = dollarsForMonth(exchanges, '2026-10', [{ date: '2026-10-07', amount: 0, payment_method: 'usd', usd_amount: null }]);
    expect(october).toMatchObject({ usd: 20, heldUsd: 120 });
  });

  it('reports one month: dollars and the sums actually exchanged or spent, plus everything held so far', () => {
    // October: +50 bought - 30 sold - 40 spent = -20 dollars; 650 000 out - 390 000 back - 520 000 spent = -260 000 sums.
    // Held through October: 100 - 20 (September) + 50 - 30 - 40 = 60. November is not counted yet.
    expect(dollarsForMonth(exchanges, '2026-10', expenses)).toEqual({ usd: -20, uzs: -260_000, heldUsd: 60 });
    // September: 100 bought for 1 280 000, 20 spent worth 256 000.
    expect(dollarsForMonth(exchanges, '2026-09', expenses)).toEqual({ usd: 80, uzs: 1_024_000, heldUsd: 80 });
    expect(dollarsForMonth(exchanges, '2026-08', expenses)).toEqual({ usd: 0, uzs: 0, heldUsd: 0 });
  });
});

describe('withExchangesByMonth', () => {
  it('moves money between the methods of the month and leaves PlayStation and other months alone', () => {
    const balances = {
      '2026-09': { cash: 500, terminal: 200, card: 100, playstation: 50 },
      '2026-10': { cash: 1_000, terminal: 0, card: 0, playstation: 70 },
    };
    const result = withExchangesByMonth(balances, [
      exchange('x1', '2026-10-05', 'cash', 'terminal', 250, 250),
      exchange('x2', '2026-10-06', 'cash', 'usd', 130, 0.01),
      exchange('x3', '2026-11-01', 'card', 'cash', 40, 40),
    ]);
    expect(result['2026-09']).toBe(balances['2026-09']);
    // Dollars are held apart: the 130 leaves cash and joins no UZS method.
    expect(result['2026-10']).toEqual({ cash: 620, terminal: 250, card: 0, playstation: 70 });
    // A month with exchanges only starts from nothing.
    expect(result['2026-11']).toEqual({ cash: 40, terminal: 0, card: -40, playstation: 0 });
    expect(balances['2026-10'].cash).toBe(1_000);
  });
});

describe('payment methods outside the club subset', () => {
  it('drops unknown or duplicated methods and keeps the application order', () => {
    expect(normalizePaymentMethods(['card', 'usd', 'playstation', 'cash', 'cash', 'qr', null, 7])).toEqual(['cash', 'card']);
    expect(normalizePaymentMethods(['terminal'])).toEqual(['terminal']);
  });

  it('falls back to every method when the setting is unusable', () => {
    for (const value of [null, 'cash', { cash: true }, 0, ['bank', 'transfer']]) {
      expect(normalizePaymentMethods(value)).toEqual(['terminal', 'cash', 'card']);
    }
  });

  it('returns a fresh list each time, so callers cannot change the defaults', () => {
    const first = normalizePaymentMethods(undefined);
    first.pop();
    expect(normalizePaymentMethods(undefined)).toEqual(['terminal', 'cash', 'card']);
  });

  it('defaults to the first enabled method, or terminal when none is given', () => {
    expect(defaultPaymentMethod(['cash', 'card'])).toBe('cash');
    expect(defaultPaymentMethod([])).toBe('terminal');
  });

  it('offers only the enabled methods for a Bar expense and adds PlayStation and dollars for Game Club', () => {
    expect(expensePaymentMethods(['terminal', 'card'], 'game_club')).toEqual(['terminal', 'card', 'playstation', 'usd']);
    expect(expensePaymentMethods(['terminal', 'card'], 'bar')).toEqual(['terminal', 'card']);
    const enabled = ['cash'] as const;
    expect(expensePaymentMethods(enabled, 'bar')).not.toBe(enabled);
  });

  it('refuses a dollar expense that would book no sums', () => {
    // 0.00001 dollars at 12 800 is 0.128 sums, which rounds to nothing.
    expect(dollarExpenseAmount(0.00001, 12_800)).toBeNull();
    expect(dollarExpenseAmount(-1, 12_800)).toBeNull();
    expect(dollarExpenseAmount(10, -12_800)).toBeNull();
    expect(dollarExpenseAmount(10, Number.POSITIVE_INFINITY)).toBeNull();
    expect(dollarExpenseAmount(50, 12_800)).toBe(640_000);
  });
});
