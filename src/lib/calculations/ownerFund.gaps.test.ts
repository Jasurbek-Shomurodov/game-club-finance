import { describe, expect, it } from 'vitest';
import type { OwnerProfitCarryover, OwnerReserveEntry, OwnerWithdrawal } from '@/types';
import {
  calculateAvailableMoney,
  calculateAvailableMoneyByMonth,
  calculateAvailableMoneyForMonth,
  sumAvailableMoneyResults,
  type AvailableMoneyByMonth,
} from './availableMoney';
import {
  buildOwnerProfitSnapshot,
  carryoversForMonth,
  gameClubWithdrawalsByMethod,
  investedBySourceForMonth,
  sumOwnerBalances,
  withdrawnBySourceForMonth,
} from './ownerProfitSnapshot';
import { applyOwnerReserve, reserveBalances, reserveExpenseMethod, reserveForMonth, type ReservePaidExpense } from './ownerReserve';

const cash = (date: string, cashIncome: number, extra: Record<string, number | null> = {}) => ({
  date, cash_income: cashIncome, terminal_income: 0, card_income: 0, playstation_income: 0, ...extra,
});
const noRows = { cashRows: [], stockRows: [], purchaseRows: [], expenseRows: [] };
const withdrawal = (overrides: Partial<OwnerWithdrawal>): OwnerWithdrawal => ({
  id: 'w', club_id: 'club', period_month: '2026-10-01', source: 'game_club', payment_method: null, amount: 100,
  comment: null, created_by: 'owner', created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-10T10:00:00Z', ...overrides,
});
const carryover = (overrides: Partial<OwnerProfitCarryover>): OwnerProfitCarryover => ({
  id: 'c', club_id: 'club', from_month: '2026-10-01', to_month: '2026-11-01', source: 'game_club', payment_method: 'cash', amount: 100,
  comment: null, created_by: 'owner', created_at: '2026-10-31T10:00:00Z', ...overrides,
});
const reserveEntry = (overrides: Partial<OwnerReserveEntry>): OwnerReserveEntry => ({
  id: 'r', club_id: 'club', kind: 'deposit', period_month: '2026-10-01', source: 'game_club', payment_method: 'cash', amount: 100,
  comment: null, collection_date: null, created_by: 'owner', created_at: '2026-10-12T10:00:00Z', ...overrides,
});
const reservePurchase = (overrides: Partial<ReservePaidExpense>): ReservePaidExpense => ({
  id: 'e', date: '2026-10-15', amount: 100, payment_source: 'game_club', payment_method: 'cash', category: 'equipment', comment: null,
  created_at: '2026-10-15T10:00:00Z', ...overrides,
});
const monthBalance = (gameClub: number, bar: number): AvailableMoneyByMonth[string] => ({
  ...sumAvailableMoneyResults([]),
  gameClub: { earned: gameClub, withdrawn: 0, available: gameClub, overdrawnBy: 0 },
  bar: { earned: bar, withdrawn: 0, available: bar, overdrawnBy: 0 },
});

describe('calculateAvailableMoneyForMonth', () => {
  it('rejects a month that is not YYYY-MM', () => {
    for (const month of ['2026-13', '2026-00', '2026-9', '2026-09-01', '']) {
      expect(() => calculateAvailableMoneyForMonth({ ...noRows, month })).toThrow(new RangeError('Month must use YYYY-MM format'));
    }
  });

  it('ends December on 31 December, not in the next year', () => {
    const result = calculateAvailableMoneyForMonth({
      ...noRows,
      month: '2026-12',
      cashRows: [cash('2026-11-30', 1), cash('2026-12-01', 200), cash('2026-12-31', 300), cash('2027-01-01', 4_000)],
    });
    expect(result.gameClub).toEqual({ earned: 500, withdrawn: 0, available: 500, overdrawnBy: 0 });
  });

  it('counts a missing method amount as nothing collected', () => {
    const result = calculateAvailableMoneyForMonth({
      ...noRows,
      month: '2026-10',
      cashRows: [cash('2026-10-02', 700, { card_income: null, terminal_income: 50 }) as never],
    });
    expect(result.gameClub.earned).toBe(750);
  });

  it('rejects a withdrawal that is not a positive amount or not dated to a month start', () => {
    const invalid = (row: Partial<OwnerWithdrawal>) => () => calculateAvailableMoneyForMonth({
      ...noRows, month: '2026-10', withdrawalRows: [withdrawal(row)],
    });
    expect(invalid({ amount: 0 })).toThrow('Withdrawal amount must be a finite number greater than zero');
    expect(invalid({ amount: -5 })).toThrow(RangeError);
    expect(invalid({ amount: Number.NaN })).toThrow(RangeError);
    expect(invalid({ period_month: '2026-10-15' })).toThrow('Withdrawal period_month must be the first day of a calendar month');
  });
});

describe('order of withdrawals within a month', () => {
  const october = { ...noRows, month: '2026-10', cashRows: [cash('2026-10-02', 1_000)] };

  it('checks rows without a time or id in the order they were recorded', () => {
    const result = calculateAvailableMoneyForMonth({
      ...october,
      withdrawalRows: [
        { period_month: '2026-10-01', source: 'game_club', amount: 600 },
        { period_month: '2026-10-01', source: 'game_club', amount: 500 },
      ],
    });
    // 1 000 earned: the first 600 is fine, the next 500 goes 100 over.
    expect(result.invalidWithdrawals).toEqual([
      { id: undefined, period_month: '2026-10-01', source: 'game_club', amount: 500, availableBefore: 400, overdrawnBy: 100 },
    ]);
    expect(result.gameClub).toEqual({ earned: 1_000, withdrawn: 1_100, available: -100, overdrawnBy: 100 });
    expect(result.hasOverWithdrawal).toBe(true);
  });

  it('breaks a tie in time by id, so the same rows always blame the same withdrawal', () => {
    const at = '2026-10-10T10:00:00Z';
    const result = calculateAvailableMoneyForMonth({
      ...october,
      withdrawalRows: [withdrawal({ id: 'b', amount: 600, created_at: at }), withdrawal({ id: 'a', amount: 500, created_at: at })],
    });
    expect(result.invalidWithdrawals.map((row) => [row.id, row.availableBefore, row.overdrawnBy])).toEqual([['b', 500, 100]]);
  });

  it('does not let Bar money cover a Game Club overdraft in the same month', () => {
    const result = calculateAvailableMoneyForMonth({
      ...october,
      stockRows: [{ date: '2026-10-03', bar_income: 5_000, bar_cost: 0, bar_profit: 0, sold_quantity: 1 }],
      withdrawalRows: [withdrawal({ id: 'gc', amount: 1_200 }), withdrawal({ id: 'bar', source: 'bar', amount: 5_000 })],
    });
    expect(result.gameClub).toMatchObject({ available: -200, overdrawnBy: 200 });
    expect(result.bar).toEqual({ earned: 5_000, withdrawn: 5_000, available: 0, overdrawnBy: 0 });
    expect(result.invalidWithdrawals.map((row) => row.id)).toEqual(['gc']);
  });
});

describe('calculateAvailableMoneyByMonth through a date', () => {
  it('leaves out rows and withdrawals after the through date', () => {
    const byMonth = calculateAvailableMoneyByMonth({
      ...noRows,
      cashRows: [cash('2026-10-20', 900), cash('2026-10-26', 5_000), cash('2026-11-02', 7_000)],
      withdrawalRows: [withdrawal({ id: 'oct', amount: 300 }), withdrawal({ id: 'nov', period_month: '2026-11-01', amount: 100 })],
      throughDate: '2026-10-25',
    });
    expect(Object.keys(byMonth)).toEqual(['2026-10']);
    expect(byMonth['2026-10'].gameClub).toEqual({ earned: 900, withdrawn: 300, available: 600, overdrawnBy: 0 });
  });

  it('sums months without letting a negative month reduce another', () => {
    const total = calculateAvailableMoney({
      ...noRows,
      cashRows: [cash('2026-09-10', 400), cash('2026-10-10', 1_000)],
      expenseRows: [{ id: 'e', date: '2026-09-11', amount: 700, category: 'rent', payment_source: 'game_club' } as never],
    });
    // September is 300 short; October's 1 000 stays whole.
    expect(total.gameClub).toEqual({ earned: 700, withdrawn: 0, available: 1_000, overdrawnBy: 300 });
  });
});

describe('buildOwnerProfitSnapshot with incomplete rows', () => {
  it('reads missing amounts as zero and numeric strings as numbers', () => {
    const snapshot = buildOwnerProfitSnapshot({
      monthlyBalances: [
        { period_month: '2026-10-01', game_club_earned: '900', game_club_withdrawn: null, bar_earned: null, bar_withdrawn: '40' } as never,
        { period_month: '2026-11-01', game_club_earned: null, game_club_withdrawn: 70, bar_earned: 15, bar_withdrawn: null } as never,
      ],
      withdrawalRows: [],
      paymentMethodBalancesByMonth: { '2026-10': { cash: '600', terminal: null } as never },
      paymentMethodBalances: { card: '300', playstation: null } as never,
    });

    expect(snapshot.byMonth['2026-10'].gameClub).toEqual({ earned: 900, withdrawn: 0, available: 900, overdrawnBy: 0 });
    // Nothing earned, 40 taken: the Bar month is overdrawn by 40.
    expect(snapshot.byMonth['2026-10'].bar).toEqual({ earned: 0, withdrawn: 40, available: -40, overdrawnBy: 40 });
    expect(snapshot.byMonth['2026-10'].hasOverWithdrawal).toBe(true);
    expect(snapshot.byMonth['2026-11'].gameClub).toEqual({ earned: 0, withdrawn: 70, available: -70, overdrawnBy: 70 });
    expect(snapshot.byMonth['2026-11'].bar).toEqual({ earned: 15, withdrawn: 0, available: 15, overdrawnBy: 0 });
    // Totals keep months apart: only positive balances are left to take, overdrafts are reported.
    expect(snapshot.total.gameClub).toEqual({ earned: 900, withdrawn: 70, available: 900, overdrawnBy: 70 });
    expect(snapshot.total.bar).toEqual({ earned: 15, withdrawn: 40, available: 15, overdrawnBy: 40 });
    expect(snapshot.paymentMethodBalancesByMonth['2026-10']).toEqual({ cash: 600, terminal: 0, card: 0, playstation: 0 });
    expect(snapshot.paymentMethodBalances).toEqual({ cash: 0, terminal: 0, card: 300, playstation: 0 });
  });

  it('has empty method balances when the payload carries none', () => {
    const snapshot = buildOwnerProfitSnapshot({ monthlyBalances: [], withdrawalRows: [] });
    expect(snapshot.paymentMethodBalancesByMonth).toEqual({});
    expect(snapshot.paymentMethodBalances).toEqual({ cash: 0, terminal: 0, card: 0, playstation: 0 });
    expect(snapshot.total.gameClub.available).toBe(0);
  });
});

describe('gameClubWithdrawalsByMethod with the reserve', () => {
  const balances = { cash: 1_000, terminal: 400 } as never;
  const withdrawals = [
    withdrawal({ id: 'w1', payment_method: 'cash', amount: 200 }),
    withdrawal({ id: 'w2', payment_method: null, amount: 50 }),
    // A method the club cannot withdraw by is never guessed into one.
    withdrawal({ id: 'w3', payment_method: 'usd' as never, amount: 30 }),
    withdrawal({ id: 'w4', payment_method: 'cash', amount: null as never }),
    withdrawal({ id: 'w5', source: 'bar', payment_method: null, amount: 999 }),
    withdrawal({ id: 'w6', payment_method: 'cash', amount: 999, period_month: '2026-09-01' }),
  ];
  const carryovers = [carryover({ from_month: '2026-09-01', to_month: '2026-10-01', amount: 100 })];
  const reserve = reserveForMonth(
    [reserveEntry({ amount: 300 }), reserveEntry({ id: 'r2', kind: 'return', amount: 100 })],
    [reservePurchase({ amount: 50 })],
    '2026-10',
  );

  it('per method: left = earned + reserve purchases + carried - withdrawn - (deposits - returns)', () => {
    const result = gameClubWithdrawalsByMethod(balances, withdrawals, '2026-10', carryovers, reserve);
    const byMethod = Object.fromEntries(result.methods.map((row) => [row.method, row]));

    // Cash: 1 000 left + 50 the reserve paid = 1 050 earned; + 100 carried in - 200 withdrawn - (300 - 100) reserved = 750.
    expect(byMethod.cash).toEqual({ method: 'cash', earned: 1_050, carried: 100, withdrawn: 200, reserved: 200, available: 750 });
    expect(byMethod.terminal).toEqual({ method: 'terminal', earned: 400, carried: 0, withdrawn: 0, reserved: 0, available: 400 });
    // Methods the balances do not list hold nothing.
    expect(byMethod.card).toEqual({ method: 'card', earned: 0, carried: 0, withdrawn: 0, reserved: 0, available: 0 });
    expect(byMethod.playstation.available).toBe(0);
    expect(result.methods.map((row) => row.method)).toEqual(['cash', 'terminal', 'card', 'playstation']);
    expect(result.unassignedWithdrawn).toBe(80);
  });

  it('reserves nothing when the month has no reserve activity', () => {
    const result = gameClubWithdrawalsByMethod(balances, withdrawals, '2026-10');
    expect(result.methods[0]).toEqual({ method: 'cash', earned: 1_000, carried: 0, withdrawn: 200, reserved: 0, available: 800 });
  });
});

describe('monthly totals per side', () => {
  it('keeps Game Club and Bar withdrawals apart and reads a missing amount as zero', () => {
    const rows = [
      withdrawal({ amount: 300 }),
      withdrawal({ id: 'b', source: 'bar', amount: 120 }),
      withdrawal({ id: 'n', amount: null as never }),
      withdrawal({ id: 'sep', period_month: '2026-09-01', amount: 9_000 }),
    ];
    expect(withdrawnBySourceForMonth(rows, '2026-10')).toEqual({ game_club: 300, bar: 120 });
  });

  it('counts an investment without a source as Game Club money', () => {
    const rows = [
      { date: '2026-10-03', amount: '2000', payment_source: 'bar' as const },
      { date: '2026-10-04', amount: 500, payment_source: null },
      { date: '2026-10-05', amount: null as never, payment_source: 'game_club' as const },
      { date: '2026-11-01', amount: 7_000, payment_source: 'game_club' as const },
    ];
    expect(investedBySourceForMonth(rows, '2026-10')).toEqual({ game_club: 500, bar: 2_000 });
  });
});

describe('carryovers', () => {
  it('nets money in and out of a month per side and per Game Club method', () => {
    const rows = [
      carryover({ from_month: '2026-09-01', to_month: '2026-10-01', amount: 400 }),
      carryover({ id: 'out', amount: 150, payment_method: 'terminal' }),
      carryover({ id: 'bar', source: 'bar', payment_method: null, amount: 70 }),
      carryover({ id: 'none', amount: null as never }),
      carryover({ id: 'other', from_month: '2026-07-01', to_month: '2026-08-01', amount: 9_000 }),
    ];
    expect(carryoversForMonth(rows, '2026-10')).toEqual({
      // Game Club: 400 in - 150 out; Bar: 70 out.
      bySource: { game_club: 250, bar: -70 },
      byMethod: { cash: 400, terminal: -150, card: 0, playstation: 0 },
    });
  });

  it('still counts money carried out of the current month as left to take', () => {
    // October already shows 500 / 100 after its carry-outs; November is not listed until it arrives.
    const byMonth = { '2026-10': monthBalance(500, 100) };
    const rows = [
      carryover({ amount: 200 }),
      carryover({ id: 'bar', source: 'bar', payment_method: null, amount: 50 }),
      // Already arrived in October: counted once, inside the October balance.
      carryover({ id: 'in', from_month: '2026-09-01', to_month: '2026-10-01', amount: 70 }),
      carryover({ id: 'none', amount: null as never }),
    ];
    const total = sumOwnerBalances(byMonth, rows, '2026-10');
    expect(total.gameClub.available).toBe(700);
    expect(total.bar.available).toBe(150);
    // A carryover is neither earnings nor a withdrawal.
    expect(total.gameClub).toMatchObject({ earned: 500, withdrawn: 0 });
  });
});

describe('owner reserve (fund)', () => {
  it('buckets a reserve purchase by its Game Club method; a Bar purchase has none', () => {
    expect(reserveExpenseMethod('game_club', 'cash')).toBe('cash');
    expect(reserveExpenseMethod('game_club', 'terminal')).toBe('terminal');
    expect(reserveExpenseMethod('game_club', 'playstation')).toBe('playstation');
    expect(reserveExpenseMethod('game_club', 'card')).toBe('card');
    // Anything else, including no method, is card money, as in migration 125.
    expect(reserveExpenseMethod('game_club', 'usd')).toBe('card');
    expect(reserveExpenseMethod('game_club', null)).toBe('card');
    // An expense without a source is Game Club money.
    expect(reserveExpenseMethod(null, 'cash')).toBe('cash');
    expect(reserveExpenseMethod('bar', 'cash')).toBeNull();
  });

  it('holds per method: deposits - returns - purchases', () => {
    const balances = reserveBalances(
      [
        reserveEntry({ amount: 500 }),
        reserveEntry({ id: 'r2', payment_method: 'terminal', amount: 300 }),
        reserveEntry({ id: 'r3', kind: 'return', amount: 120 }),
        reserveEntry({ id: 'r4', source: 'bar', payment_method: null, amount: 200 }),
      ],
      [
        reservePurchase({ amount: 80 }),
        reservePurchase({ id: 'e2', payment_source: null, payment_method: 'terminal', amount: 40 }),
        reservePurchase({ id: 'e3', payment_source: 'bar', payment_method: 'cash', amount: 60 }),
      ],
    );
    // Cash: 500 - 120 - 80 = 300. Terminal: 300 - 40 = 260. Game Club holds 800 - 120 - 120 = 560.
    expect(balances.game_club).toEqual({
      deposited: 800, returned: 120, spent: 120, held: 560, byMethod: { cash: 300, terminal: 260, card: 0, playstation: 0 },
    });
    // The Bar purchase was paid in cash but touches no Game Club method.
    expect(balances.bar).toEqual({ deposited: 200, returned: 0, spent: 60, held: 140, byMethod: { cash: 0, terminal: 0, card: 0, playstation: 0 } });
  });

  it('adds a month that only has reserve activity, overdrawn by what was set aside from nothing', () => {
    const result = applyOwnerReserve({ '2026-10': monthBalance(900, 0) }, [reserveEntry({ period_month: '2026-08-01', amount: 100 })], []);
    expect(Object.keys(result)).toEqual(['2026-08', '2026-10']);
    expect(result['2026-08'].gameClub).toEqual({ earned: 0, withdrawn: 0, available: -100, overdrawnBy: 100 });
    expect(result['2026-08'].hasOverWithdrawal).toBe(true);
    // Another month's profit does not cover it.
    expect(result['2026-10'].gameClub).toEqual({ earned: 900, withdrawn: 0, available: 900, overdrawnBy: 0 });
  });

  it('keeps a month flagged when it already had an invalid withdrawal', () => {
    const invalid = { period_month: '2026-10-01', source: 'game_club' as const, amount: 5, availableBefore: 0, overdrawnBy: 5 };
    const base = { ...monthBalance(900, 0), invalidWithdrawals: [invalid] };
    expect(applyOwnerReserve({ '2026-10': base }, [], [])['2026-10'].hasOverWithdrawal).toBe(true);
  });
});
