import { describe, expect, it } from 'vitest';
import {
  calculateAvailableMoney,
  calculateAvailableMoneyByMonth,
  calculateAvailableMoneyForMonth,
} from './availableMoney';

const expense = (
  id: string,
  date: string,
  amount: number,
  paymentSource: 'game_club' | 'bar',
) => ({
  id,
  date,
  amount,
  category: 'other',
  payment_source: paymentSource,
  comment: null,
  created_at: `${date}T10:00:00Z`,
});

describe('available owner money', () => {
  it('keeps retained money available in its original month and sums the month buckets', () => {
    const input = {
      cashRows: [
        {
          date: '2026-07-31',
          cash_income: 1_000_000,
          terminal_income: 200_000,
          card_income: 100_000,
          playstation_income: 200_000,
        },
        {
          date: '2026-08-01',
          cash_income: 500_000,
          terminal_income: 300_000,
          card_income: 200_000,
          playstation_income: 100_000,
        },
      ],
      stockRows: [
        { date: '2026-07-31', bar_income: 1_000_000, bar_profit: 0, bar_cost: 0, sold_quantity: 0 },
        { date: '2026-08-01', bar_income: 500_000, bar_profit: 0, bar_cost: 0, sold_quantity: 0 },
      ],
      purchaseRows: [
        { date: '2026-07-01', quantity: 10, cost_price: 100_000 },
        { date: '2026-07-31', quantity: 2, cost_price: 100_000 },
      ],
      expenseRows: [
        expense('club-expense', '2026-08-01', 300_000, 'game_club'),
        expense('bar-expense', '2026-08-01', 100_000, 'bar'),
      ],
      debtPaymentRows: [
        { date: '2026-08-01', amount: 200_000, payment_method: 'cash' },
      ],
      withdrawalRows: [
        { id: 'club-take', period_month: '2026-08-01', source: 'game_club' as const, amount: 1_000_000 },
        { id: 'bar-take', period_month: '2026-08-01', source: 'bar' as const, amount: 400_000 },
      ],
    };

    const byMonth = calculateAvailableMoneyByMonth(input);
    const total = calculateAvailableMoney(input);

    expect(byMonth['2026-07'].gameClub.available).toBe(1_500_000);
    expect(byMonth['2026-07'].bar.available).toBe(800_000);
    expect(byMonth['2026-08'].gameClub.available).toBe(0);
    expect(byMonth['2026-08'].bar.available).toBe(0);
    expect(total.gameClub).toEqual({
      earned: 2_500_000,
      withdrawn: 1_000_000,
      available: 1_500_000,
      overdrawnBy: 0,
    });
    expect(total.bar).toEqual({
      earned: 1_200_000,
      withdrawn: 400_000,
      available: 800_000,
      overdrawnBy: 0,
    });
    // The game club and bar are separate businesses: no combined totals exist.
    expect(total).not.toHaveProperty('totalAvailable');
    expect(total.hasOverWithdrawal).toBe(false);
  });

  it('returns only the selected calendar month and a full withdrawal leaves zero', () => {
    const result = calculateAvailableMoneyForMonth({
      month: '2026-08',
      cashRows: [
        { date: '2026-07-31', cash_income: 900, terminal_income: 0, card_income: 0 },
        { date: '2026-08-01', cash_income: 1_000, terminal_income: 100, card_income: 0 },
        { date: '2026-09-01', cash_income: 800, terminal_income: 0, card_income: 0 },
      ],
      stockRows: [],
      purchaseRows: [],
      expenseRows: [expense('august', '2026-08-20', 100, 'game_club')],
      withdrawalRows: [
        { period_month: '2026-07-01', source: 'game_club', amount: 900 },
        { period_month: '2026-08-01', source: 'game_club', amount: 1_000 },
      ],
    });

    expect(result.gameClub).toEqual({
      earned: 1_000,
      withdrawn: 1_000,
      available: 0,
      overdrawnBy: 0,
    });
    expect(result.bar.available).toBe(0);
  });

  it('does not let retained money from another month cover a withdrawal', () => {
    const result = calculateAvailableMoney({
      cashRows: [
        { date: '2026-07-01', cash_income: 1_000, terminal_income: 0, card_income: 0 },
        { date: '2026-08-01', cash_income: 100, terminal_income: 0, card_income: 0 },
      ],
      stockRows: [],
      purchaseRows: [],
      expenseRows: [],
      withdrawalRows: [
        { id: 'august-overdraw', period_month: '2026-08-01', source: 'game_club', amount: 200 },
      ],
    });

    expect(result.gameClub.available).toBe(1_000);
    expect(result.gameClub.overdrawnBy).toBe(100);
    expect(result.bar.available).toBe(0);
    expect(result.invalidWithdrawals).toEqual([
      {
        id: 'august-overdraw',
        period_month: '2026-08-01',
        source: 'game_club',
        amount: 200,
        availableBefore: 100,
        overdrawnBy: 100,
      },
    ]);
  });

  it('does not let a loss bucket reduce another month/source withdrawable balance', () => {
    const result = calculateAvailableMoney({
      cashRows: [
        { date: '2026-07-01', cash_income: 1_000, terminal_income: 0, card_income: 0 },
      ],
      stockRows: [],
      purchaseRows: [],
      expenseRows: [expense('august-loss', '2026-08-01', 300, 'game_club')],
    });

    expect(result.gameClub.earned).toBe(700);
    expect(result.gameClub.available).toBe(1_000);
    expect(result.gameClub.overdrawnBy).toBe(300);
    expect(result.bar.available).toBe(0);
  });

  it('does not allow one source balance to cover a withdrawal from the other', () => {
    const result = calculateAvailableMoneyForMonth({
      month: '2026-08',
      cashRows: [
        { date: '2026-08-01', cash_income: 1_000, terminal_income: 0, card_income: 0 },
      ],
      stockRows: [],
      purchaseRows: [],
      expenseRows: [],
      withdrawalRows: [
        { id: 'bar-overdraw', period_month: '2026-08-01', source: 'bar', amount: 100 },
      ],
    });

    expect(result.gameClub.available).toBe(1_000);
    expect(result.bar.available).toBe(-100);
    expect(result.bar.overdrawnBy).toBe(100);
    expect(result.invalidWithdrawals).toEqual([
      {
        id: 'bar-overdraw',
        period_month: '2026-08-01',
        source: 'bar',
        amount: 100,
        availableBefore: 0,
        overdrawnBy: 100,
      },
    ]);
  });

  it('deducts bar expenses when there are no stock purchases', () => {
    const result = calculateAvailableMoneyForMonth({
      month: '2026-08',
      cashRows: [],
      stockRows: [
        { date: '2026-08-01', bar_income: 500, bar_profit: 500, bar_cost: 0, sold_quantity: 1 },
      ],
      purchaseRows: [],
      expenseRows: [expense('bar-expense', '2026-08-01', 125, 'bar')],
    });

    expect(result.bar.earned).toBe(375);
    expect(result.bar.available).toBe(375);
  });

  it('uses rows through the requested date inclusively in aggregate totals', () => {
    const result = calculateAvailableMoney({
      cashRows: [
        { date: '2026-07-31', cash_income: 300, terminal_income: 0, card_income: 0 },
        { date: '2026-08-01', cash_income: 900, terminal_income: 0, card_income: 0 },
      ],
      stockRows: [],
      purchaseRows: [],
      expenseRows: [expense('included', '2026-07-31', 50, 'game_club')],
      withdrawalRows: [
        { period_month: '2026-07-01', source: 'game_club', amount: 100 },
        { period_month: '2026-08-01', source: 'game_club', amount: 200 },
      ],
      throughDate: '2026-07-31',
    });

    expect(result.gameClub).toEqual({
      earned: 250,
      withdrawn: 100,
      available: 150,
      overdrawnBy: 0,
    });
  });

  it('rejects malformed withdrawal amounts and noncanonical periods', () => {
    expect(() => calculateAvailableMoneyForMonth({
      month: '2026-08',
      cashRows: [],
      stockRows: [],
      purchaseRows: [],
      expenseRows: [],
      withdrawalRows: [{ period_month: '2026-08-01', source: 'bar', amount: -100 }],
    })).toThrow(new RangeError('Withdrawal amount must be a finite number greater than zero'));

    expect(() => calculateAvailableMoneyForMonth({
      month: '2026-08',
      cashRows: [],
      stockRows: [],
      purchaseRows: [],
      expenseRows: [],
      withdrawalRows: [{ period_month: '2026-08-03', source: 'bar', amount: 100 }],
    })).toThrow(new RangeError('Withdrawal period_month must be the first day of a calendar month'));
  });
});
