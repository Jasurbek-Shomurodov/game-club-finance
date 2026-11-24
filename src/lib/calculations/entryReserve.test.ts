import { describe, expect, it } from 'vitest';
import type { MoneyReportActivity } from './moneyReport';
import {
  entryMethodReserveAmounts,
  entryMethodRows,
  entryReserveActions,
  isGameClubIncomeEntry,
  reservedFromGameClubOn,
} from './entryReserve';

const income = (breakdown: Partial<NonNullable<MoneyReportActivity['paymentBreakdown']>> = {}): MoneyReportActivity => {
  const paymentBreakdown = { cash: 0, terminal: 0, card: 0, playstation: 0, ...breakdown };
  return {
    id: 'd1',
    source: 'daily_cash',
    kind: 'income',
    category: null,
    amount: Object.values(paymentBreakdown).reduce((sum, value) => sum + value, 0),
    paymentMethod: null,
    comment: null,
    createdAt: '2026-11-20T10:00:00Z',
    paymentBreakdown,
  };
};

const expense: MoneyReportActivity = {
  id: 'e1', source: 'expense', kind: 'expense', category: 'cleaning', amount: -100_000,
  paymentMethod: 'cash', paymentSource: 'game_club', comment: null, createdAt: null,
};

describe('entryMethodRows', () => {
  it('lists the methods that moved money in method order, with their share of what came in', () => {
    expect(entryMethodRows({ cash: 600_000, terminal: 0, card: 400_000, playstation: -50_000 })).toEqual([
      { method: 'cash', amount: 600_000, share: 0.6 },
      { method: 'card', amount: 400_000, share: 0.4 },
      { method: 'playstation', amount: -50_000, share: 0 },
    ]);
  });

  it('is empty without a split', () => {
    expect(entryMethodRows(undefined)).toEqual([]);
    expect(entryMethodRows({ cash: 0, terminal: 0, card: 0, playstation: 0 })).toEqual([]);
  });

  it('gives no share when nothing came in', () => {
    expect(entryMethodRows({ cash: -10, terminal: 0, card: 0, playstation: 0 })).toEqual([{ method: 'cash', amount: -10, share: 0 }]);
  });

  it('treats a non-number part as nothing', () => {
    expect(entryMethodRows({ cash: Number.NaN, terminal: 5, card: 0, playstation: 0 })).toEqual([{ method: 'terminal', amount: 5, share: 1 }]);
  });
});

describe('entryReserveActions', () => {
  const entry = income({ cash: 1_200_000, terminal: 850_000, card: 0, playstation: -10_000 });

  it('gives an owner one action per method that brought money in, and one for all of them', () => {
    expect(entryReserveActions({ canMoveToReserve: true, activity: entry })).toEqual({
      kind: 'open',
      methods: ['cash', 'terminal'],
      all: { cash: 1_200_000, terminal: 850_000 },
    });
  });

  it('gives a non-owner nothing', () => {
    expect(entryReserveActions({ canMoveToReserve: false, activity: entry })).toEqual({ kind: 'none' });
  });

  it('gives nothing on an expense, a debt payment or an exchange', () => {
    expect(entryReserveActions({ canMoveToReserve: true, activity: expense })).toEqual({ kind: 'none' });
    expect(entryReserveActions({ canMoveToReserve: true, activity: { ...expense, kind: 'debt_payment', source: 'debt_payment', amount: 50_000 } })).toEqual({ kind: 'none' });
    expect(entryReserveActions({ canMoveToReserve: true, activity: { ...expense, kind: 'exchange', source: 'exchange', amount: 0 } })).toEqual({ kind: 'none' });
  });

  it('gives nothing when no method brought money in', () => {
    expect(entryReserveActions({ canMoveToReserve: true, activity: income({ cash: -5 }) })).toEqual({ kind: 'none' });
    expect(entryReserveActions({ canMoveToReserve: true, activity: income() })).toEqual({ kind: 'none' });
  });

  it('offers whole sums only', () => {
    expect(entryReserveActions({ canMoveToReserve: true, activity: income({ cash: 1_000.7, card: 0.4 }) })).toEqual({
      kind: 'open', methods: ['cash'], all: { cash: 1_000 },
    });
  });
});

describe('entryMethodReserveAmounts', () => {
  const actions = entryReserveActions({ canMoveToReserve: true, activity: income({ cash: 300_000, terminal: 200_000 }) });

  it('passes only the tapped method', () => {
    expect(entryMethodReserveAmounts(actions, 'terminal')).toEqual({ terminal: 200_000 });
    expect(entryMethodReserveAmounts(actions, 'cash')).toEqual({ cash: 300_000 });
  });

  it('passes nothing for a method without money or without actions', () => {
    expect(entryMethodReserveAmounts(actions, 'card')).toBeNull();
    expect(entryMethodReserveAmounts({ kind: 'none' }, 'cash')).toBeNull();
  });
});

describe('isGameClubIncomeEntry', () => {
  it('is the day cash entry only', () => {
    expect(isGameClubIncomeEntry(income({ cash: 1 }))).toBe(true);
    expect(isGameClubIncomeEntry({ ...income({ cash: 1 }), paymentBreakdown: undefined })).toBe(false);
    expect(isGameClubIncomeEntry(expense)).toBe(false);
  });
});

describe('reservedFromGameClubOn', () => {
  it('nets the Game Club money that went into the reserve on that day', () => {
    expect(reservedFromGameClubOn([
      { date: '2026-11-20', source: 'game_club', method: 'cash', amount: 300_000 },
      { date: '2026-11-20', source: 'game_club', method: 'terminal', amount: 200_000 },
      { date: '2026-11-20', source: 'game_club', method: 'cash', amount: -50_000 },
      { date: '2026-11-20', source: 'bar', method: null, amount: 90_000 },
      { date: '2026-11-21', source: 'game_club', method: 'card', amount: 70_000 },
    ], '2026-11-20')).toBe(450_000);
    expect(reservedFromGameClubOn([], '2026-11-20')).toBe(0);
  });

  it('does not count a dollar buy or sale inside the reserve as money from the till', () => {
    expect(reservedFromGameClubOn([
      // Buy: the sums return to the method and are exchanged into dollars.
      { date: '2026-11-20', source: 'game_club', method: 'cash', amount: -1_280_000 },
      { date: '2026-11-20', source: 'game_club', method: 'usd', amount: 1_280_000 },
      // Sell: dollars become sums that are put back in.
      { date: '2026-11-20', source: 'game_club', method: 'usd', amount: -640_000 },
      { date: '2026-11-20', source: 'game_club', method: 'card', amount: 640_000 },
    ], '2026-11-20')).toBe(0);
  });

  it('leaves out deposits made from collected money', () => {
    const moves = [
      { date: '2026-11-20', source: 'game_club' as const, method: 'cash', amount: 300_000 },
      { date: '2026-11-20', source: 'game_club' as const, method: 'cash', amount: 500_000 },
    ];
    expect(reservedFromGameClubOn(moves, '2026-11-20', [
      { kind: 'reserve', date: '2026-11-20', amount: -500_000 },
      { kind: 'collect', date: '2026-11-20', amount: 900_000 },
      { kind: 'reserve', date: '2026-11-19', amount: -100_000 },
    ])).toBe(300_000);
  });

  it('is never below zero', () => {
    expect(reservedFromGameClubOn([
      { date: '2026-11-20', source: 'game_club', method: 'cash', amount: -400_000 },
    ], '2026-11-20')).toBe(0);
  });
});
