import { describe, expect, it } from 'vitest';
import type { OwnerProfitCarryover, OwnerWithdrawal } from '../../types';
import {
  applyOwnerProfitCarryovers,
  availableForPaymentMethod,
  buildOwnerProfitSnapshot,
  gameClubMoneyLeftByPaymentMethodByMonth,
  gameClubWithdrawalsByMethod,
  withdrawnBySourceForMonth,
} from './ownerProfitSnapshot';
import { calculateGameClubMoneyLeftByPaymentMethod, type ExpenseRow } from './dashboardMetrics';

describe('owner profit snapshot', () => {
  it('builds isolated monthly balances and positive aggregate availability', () => {
    const result = buildOwnerProfitSnapshot({
      monthlyBalances: [
        {
          period_month: '2026-07-01',
          game_club_earned: 1_000,
          bar_earned: 500,
          game_club_withdrawn: 200,
          bar_withdrawn: 500,
        },
        {
          period_month: '2026-08-01',
          game_club_earned: -100,
          bar_earned: 300,
          game_club_withdrawn: 0,
          bar_withdrawn: 100,
        },
      ],
      withdrawalRows: [],
      paymentMethodBalancesByMonth: {
        '2026-07': { cash: 800, terminal: 200 },
        '2026-08': { cash: -100, card: 50 },
      },
      paymentMethodBalances: { cash: 700, terminal: 250, card: 50, playstation: 100 },
    });

    expect(result.paymentMethodBalancesByMonth['2026-07']).toEqual({ cash: 800, terminal: 200, card: 0, playstation: 0 });
    expect(result.paymentMethodBalancesByMonth['2026-08']).toEqual({ cash: -100, terminal: 0, card: 50, playstation: 0 });
    expect(result.paymentMethodBalancesByMonth['2026-09']).toBeUndefined();
    // The bar card shows earned money before withdrawals, matching the method cards.
    expect(result.byMonth['2026-07'].bar.earned).toBe(500);
    expect(result.byMonth['2026-07'].bar.available).toBe(0);
    expect(result.byMonth['2026-07'].gameClub.available).toBe(800);
    expect(result.byMonth['2026-08'].gameClub.overdrawnBy).toBe(100);
    expect(result.total.gameClub.available).toBe(800);
    expect(result.total.bar.available).toBe(200);
    expect(result.paymentMethodBalances).toEqual({
      cash: 700,
      terminal: 250,
      card: 50,
      playstation: 100,
    });
  });

  it('defaults payment-method balances for compatibility with the previous RPC payload', () => {
    const result = buildOwnerProfitSnapshot({ monthlyBalances: [], withdrawalRows: [] });

    expect(result.paymentMethodBalancesByMonth).toEqual({});
    expect(result.paymentMethodBalances).toEqual({ cash: 0, terminal: 0, card: 0, playstation: 0 });
  });
});

it('shows zero remaining for July after full Club and Bar withdrawals', () => {
  const { byMonth } = buildOwnerProfitSnapshot({
    monthlyBalances: [{ period_month: '2026-07-01', game_club_earned: 17_000_000,
      bar_earned: 5_109_304, game_club_withdrawn: 17_000_000, bar_withdrawn: 5_109_304 }],
    withdrawalRows: [],
    paymentMethodBalancesByMonth: { '2026-07': { cash: 415_600, terminal: 1_221_400, card: 15_363_000 } },
  });
  expect(byMonth['2026-07'].gameClub.earned).toBe(17_000_000);
  expect(byMonth['2026-07'].bar.withdrawn).toBe(5_109_304);
  expect(byMonth['2026-07'].gameClub.available).toBe(0);
  expect(byMonth['2026-07'].bar.available).toBe(0);
  expect(byMonth['2026-07']).not.toHaveProperty('totalAvailable');
});

it('preserves monthly deficits and aggregate overdrawn flags', () => {
  const { byMonth, total } = buildOwnerProfitSnapshot({
    monthlyBalances: [{ period_month: '2026-07-01', game_club_earned: 100,
      bar_earned: 300, game_club_withdrawn: 200, bar_withdrawn: 0 }],
    withdrawalRows: [],
  });
  expect(byMonth['2026-07'].bar.available).toBe(300);
  expect(byMonth['2026-07'].gameClub.available).toBe(-100);
  expect(total.gameClub.available).toBe(0);
  expect(total.bar.available).toBe(300);
  expect(total.hasOverWithdrawal).toBe(true);
});

describe('Game Club withdrawals by payment method', () => {
  const row = (overrides: Partial<OwnerWithdrawal>): OwnerWithdrawal => ({
    id: String(Math.random()),
    club_id: 'club',
    period_month: '2026-08-01',
    source: 'game_club',
    payment_method: null,
    amount: 0,
    comment: null,
    created_by: 'owner',
    created_at: '2026-08-10T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
    ...overrides,
  });

  it('assigns method withdrawals and keeps unassigned rows separate', () => {
    const result = gameClubWithdrawalsByMethod(
      { cash: 100, terminal: 17_830_000, card: 5_747_000, playstation: 0 },
      [
        row({ payment_method: 'terminal', amount: 17_000_000 }),
        row({ payment_method: 'card', amount: 5_747_000 }),
        row({ amount: 400 }),
        row({ source: 'bar', amount: 999 }),
        row({ period_month: '2026-07-01', payment_method: 'cash', amount: 50 }),
      ],
      '2026-08',
    );

    expect(result.methods).toEqual([
      { method: 'cash', earned: 100, carried: 0, withdrawn: 0, available: 100 },
      { method: 'terminal', earned: 17_830_000, carried: 0, withdrawn: 17_000_000, available: 830_000 },
      { method: 'card', earned: 5_747_000, carried: 0, withdrawn: 5_747_000, available: 0 },
      { method: 'playstation', earned: 0, carried: 0, withdrawn: 0, available: 0 },
    ]);
    expect(result.unassignedWithdrawn).toBe(400);
  });

  it('caps a method withdrawal by the Game Club month balance', () => {
    expect(availableForPaymentMethod(830_000, 0)).toBe(0);
    expect(availableForPaymentMethod(830_000, 1_000_000)).toBe(830_000);
    expect(availableForPaymentMethod(-5, 1_000)).toBe(0);
  });
});

describe('owner profit carryovers', () => {
  const carryover = (overrides: Partial<OwnerProfitCarryover>): OwnerProfitCarryover => ({
    id: String(Math.random()),
    club_id: 'club',
    from_month: '2026-09-01',
    to_month: '2026-10-01',
    source: 'bar',
    payment_method: null,
    amount: 0,
    comment: null,
    created_by: 'owner',
    created_at: '2026-09-30T00:00:00Z',
    ...overrides,
  });
  const { byMonth } = buildOwnerProfitSnapshot({
    monthlyBalances: [
      { period_month: '2026-09-01', game_club_earned: 1_000, bar_earned: 500, game_club_withdrawn: 100, bar_withdrawn: 0 },
      { period_month: '2026-10-01', game_club_earned: 200, bar_earned: 0, game_club_withdrawn: 0, bar_withdrawn: 0 },
    ],
    withdrawalRows: [],
  });

  it('moves availability to the next month without changing earnings or withdrawals', () => {
    const result = applyOwnerProfitCarryovers(byMonth, [
      carryover({ amount: 300 }),
      carryover({ source: 'game_club', payment_method: 'cash', amount: 400 }),
    ]);

    expect(result['2026-09'].bar).toEqual({ earned: 500, withdrawn: 0, available: 200, overdrawnBy: 0 });
    expect(result['2026-09'].gameClub.available).toBe(500);
    expect(result['2026-09'].gameClub.earned).toBe(1_000);
    expect(result['2026-10'].bar.available).toBe(300);
    expect(result['2026-10'].gameClub.available).toBe(600);
    // The original balances are not mutated.
    expect(byMonth['2026-09'].bar.available).toBe(500);
  });

  it('creates the receiving month and hides months after the current one', () => {
    const rows = [carryover({ from_month: '2026-10-01', to_month: '2026-11-01', amount: 50, source: 'game_club', payment_method: 'card' })];

    expect(applyOwnerProfitCarryovers(byMonth, rows)['2026-11'].gameClub).toEqual({ earned: 0, withdrawn: 0, available: 50, overdrawnBy: 0 });
    expect(applyOwnerProfitCarryovers(byMonth, rows, '2026-10')['2026-11']).toBeUndefined();
    expect(applyOwnerProfitCarryovers(byMonth, rows, '2026-10')['2026-10'].gameClub.available).toBe(150);
  });

  it('flags a month overdrawn by a carryover', () => {
    const result = applyOwnerProfitCarryovers(byMonth, [carryover({ amount: 600 })]);
    expect(result['2026-09'].bar.overdrawnBy).toBe(100);
    expect(result['2026-09'].hasOverWithdrawal).toBe(true);
  });

  it('applies Game Club carryovers to their payment method', () => {
    const rows = [
      carryover({ source: 'game_club', payment_method: 'terminal', amount: 70 }),
      carryover({ from_month: '2026-08-01', to_month: '2026-09-01', source: 'game_club', payment_method: 'cash', amount: 20 }),
      carryover({ amount: 999 }),
    ];
    const september = gameClubWithdrawalsByMethod({ cash: 10, terminal: 100, card: 0, playstation: 0 }, [], '2026-09', rows);
    const october = gameClubWithdrawalsByMethod({ cash: 0, terminal: 0, card: 0, playstation: 0 }, [], '2026-10', rows);

    expect(september.methods.slice(0, 2)).toEqual([
      { method: 'cash', earned: 10, carried: 20, withdrawn: 0, available: 30 },
      { method: 'terminal', earned: 100, carried: -70, withdrawn: 0, available: 30 },
    ]);
    expect(october.methods[1]).toEqual({ method: 'terminal', earned: 0, carried: 70, withdrawn: 0, available: 70 });
  });
});

describe('gameClubMoneyLeftByPaymentMethodByMonth', () => {
  const expense = (date: string, amount: number, payment_method: string, payment_source: 'game_club' | 'bar' = 'game_club'): ExpenseRow => ({
    id: `${date}-${amount}`, date, amount, category: 'rent', payment_method, payment_source, comment: null, created_at: date,
  });

  it('matches the per-month calculation on rows filtered to each month', () => {
    const cashRows = [
      { date: '2026-07-01', cash_income: 100, terminal_income: 50, card_income: 20, playstation_income: 10 },
      { date: '2026-07-31', cash_income: 40, terminal_income: 0, card_income: 0, playstation_income: 0 },
      { date: '2026-08-02', cash_income: 70, terminal_income: 30, card_income: 0, playstation_income: 5 },
    ];
    const expenseRows = [
      expense('2026-07-15', 25, 'cash'),
      expense('2026-07-16', 1_000, 'cash', 'bar'),
      expense('2026-09-01', 15, 'terminal'),
    ];
    const debtPaymentRows = [
      { date: '2026-08-10', amount: 60, payment_method: 'card' },
    ];

    const result = gameClubMoneyLeftByPaymentMethodByMonth(cashRows, expenseRows, debtPaymentRows);

    expect(Object.keys(result).sort()).toEqual(['2026-07', '2026-08', '2026-09']);
    for (const month of Object.keys(result)) {
      expect(result[month]).toEqual(calculateGameClubMoneyLeftByPaymentMethod(
        cashRows.filter((row) => row.date.startsWith(month)),
        expenseRows.filter((row) => row.date.startsWith(month)),
        debtPaymentRows.filter((row) => row.date.startsWith(month)),
      ));
    }
    expect(result['2026-07']).toEqual({ cash: 115, terminal: 50, card: 20, playstation: 10 });
    expect(result['2026-09']).toEqual({ cash: 0, terminal: -15, card: 0, playstation: 0 });
  });

  it('returns no months without activity', () => {
    expect(gameClubMoneyLeftByPaymentMethodByMonth([], [], [])).toEqual({});
  });
});

describe('withdrawn by source for a month', () => {
  const row = (source: 'game_club' | 'bar', amount: number, month = '2026-09-01') => ({
    id: `${source}-${amount}`, club_id: 'c', period_month: month, source, amount, comment: null,
    created_by: 'u', created_at: '', updated_at: '',
  }) as OwnerWithdrawal;

  it('keeps game club and bar totals apart and ignores other months', () => {
    expect(withdrawnBySourceForMonth([
      row('bar', 4_528_547), row('game_club', 4_500_000), row('game_club', 500_000), row('bar', 1, '2026-08-01'),
    ], '2026-09')).toEqual({ game_club: 5_000_000, bar: 4_528_547 });
    expect(withdrawnBySourceForMonth([], '2026-09')).toEqual({ game_club: 0, bar: 0 });
  });
});
