import { describe, expect, it } from 'vitest';
import {
  isCurrentMonthPeriod,
  monthToDateRange,
  moneyStillHeld,
  moneyStillHeldByMethod,
  parseCollectedMoneyMoves,
  parseCollectionBalances,
  periodCoversMoneyNow,
  summarizeCollectedMoney,
  summarizeMoneyWhereabouts,
  type CollectedMoneyMove,
} from './collectedMoney';

const move = (values: Partial<CollectedMoneyMove>): CollectedMoneyMove => ({
  kind: 'collect',
  id: 'r1',
  date: '2026-11-03',
  method: 'cash',
  amount: 0,
  comment: null,
  createdBy: 'u1',
  createdAt: '2026-11-03T10:00:00Z',
  ...values,
});

describe('summarizeCollectedMoney', () => {
  it('groups one collect across methods and keeps what is still held', () => {
    const summary = summarizeCollectedMoney([
      move({ id: 'r1', date: '2026-11-02', method: 'cash', amount: 2_000_000 }),
      move({ id: 'r1', date: '2026-11-02', method: 'card', amount: 500_000 }),
      move({ id: 'r2', date: '2026-11-04', method: 'cash', amount: 1_000_000, createdAt: '2026-11-04T09:00:00Z' }),
      move({ kind: 'expense', id: 'e1', date: '2026-11-03', method: 'cash', amount: -3_000_000 }),
      move({ kind: 'reserve', id: 'v1', date: '2026-11-05', method: 'card', amount: -200_000 }),
    ]);
    expect(summary.collected).toEqual({ cash: 3_000_000, terminal: 0, card: 500_000, playstation: 0, total: 3_500_000 });
    expect(summary.spent).toMatchObject({ cash: 3_000_000, total: 3_000_000 });
    expect(summary.toReserve).toMatchObject({ card: 200_000, total: 200_000 });
    expect(summary.held).toEqual({ cash: 0, terminal: 0, card: 300_000, playstation: 0, total: 300_000 });
    expect(summary.collections.map((group) => [group.id, group.total])).toEqual([['r2', 1_000_000], ['r1', 2_500_000]]);
    expect(summary.collections[1]).toMatchObject({ cash: 2_000_000, card: 500_000, date: '2026-11-02' });
  });

  it('is empty without moves', () => {
    expect(summarizeCollectedMoney([]).held.total).toBe(0);
    expect(summarizeCollectedMoney([]).collections).toEqual([]);
  });
});

describe('moneyStillHeld', () => {
  it('is the money left minus what collected money holds', () => {
    expect(moneyStillHeld(3_000_000, 2_000_000)).toBe(1_000_000);
  });
});

describe('parseCollectedMoneyMoves', () => {
  it('keeps well-formed rows and drops the rest', () => {
    expect(parseCollectedMoneyMoves([
      { kind: 'collect', id: 'r1', date: '2026-11-02', method: 'cash', amount: '100', comment: 'x', created_by: 'u', created_at: 't' },
      { kind: 'other', id: 'r1', date: '2026-11-02', method: 'cash', amount: 1 },
      { kind: 'collect', id: 'r1', date: '2026-11-02', method: 'usd', amount: 1 },
      { kind: 'expense', id: 'e', date: '2026-11-02', method: 'card', amount: 'NaN' },
      null,
    ])).toEqual([{ kind: 'collect', id: 'r1', date: '2026-11-02', method: 'cash', amount: 100, comment: 'x', createdBy: 'u', createdAt: 't' }]);
    expect(parseCollectedMoneyMoves(null)).toEqual([]);
  });
});

describe('parseCollectionBalances', () => {
  it('reads each method and never goes below zero', () => {
    expect(parseCollectionBalances({ cash: { till: '5', collected: -1 } })).toEqual({
      cash: { till: 5, collected: 0 },
      terminal: { till: 0, collected: 0 },
      card: { till: 0, collected: 0 },
      playstation: { till: 0, collected: 0 },
    });
    expect(parseCollectionBalances(null)).toBeNull();
  });
});

describe('moneyStillHeldByMethod', () => {
  it('takes what collected money holds out of each method and sums the till', () => {
    const held = summarizeCollectedMoney([
      move({ method: 'cash', amount: 1_500_000 }),
      move({ id: 'r2', method: 'terminal', amount: 400_000 }),
    ]).held;
    expect(moneyStillHeldByMethod({ cash: 2_000_000, terminal: 300_000, card: 700_000, playstation: 50_000 }, held)).toEqual({
      cash: 500_000, terminal: -100_000, card: 700_000, playstation: 50_000, total: 1_150_000,
    });
  });
});

describe('summarizeMoneyWhereabouts', () => {
  it('splits the money into the till, collected money and the reserve, and totals the sums only', () => {
    expect(summarizeMoneyWhereabouts({
      left: { cash: 3_000_000, terminal: 1_000_000, card: 0, playstation: 234_000 },
      collectedMoves: [
        move({ method: 'cash', amount: 2_500_000 }),
        move({ kind: 'expense', id: 'e1', method: 'cash', amount: -500_000 }),
      ],
      reserve: { sums: 15_000_000, usd: 1_200 },
    })).toEqual({ kassa: 2_234_000, collected: 2_000_000, reserveSums: 15_000_000, reserveUsd: 1_200, totalSums: 19_234_000 });
  });
});

describe('where the money is now', () => {
  const today = '2026-11-28';

  it('counts the till from the business month\'s first day through today', () => {
    expect(monthToDateRange(today)).toEqual({ from: '2026-11-01', to: today });
    expect(monthToDateRange('2026-12-01')).toEqual({ from: '2026-12-01', to: '2026-12-01' });
  });

  it('reuses a period\'s own figures only when it starts in today\'s month and reaches today', () => {
    expect(periodCoversMoneyNow({ from: '2026-11-01', to: '2026-11-30' }, today)).toBe(true);
    expect(periodCoversMoneyNow({ from: '2026-11-10', to: today }, today)).toBe(true);
    // Ends before today: the days since are missing.
    expect(periodCoversMoneyNow({ from: '2026-11-01', to: '2026-11-20' }, today)).toBe(false);
    // Starts last month: the cards would add October's leftover to a till that starts November at zero.
    expect(periodCoversMoneyNow({ from: '2026-10-15', to: today }, today)).toBe(false);
    expect(periodCoversMoneyNow({ from: '2026-10-01', to: '2026-10-31' }, today)).toBe(false);
  });

  it('calls a period the current month only from its first day through today or later', () => {
    expect(isCurrentMonthPeriod({ from: '2026-11-01', to: '2026-11-30' }, today)).toBe(true);
    expect(isCurrentMonthPeriod({ from: '2026-11-01', to: today }, today)).toBe(true);
    expect(isCurrentMonthPeriod({ from: '2026-11-10', to: today }, today)).toBe(false);
    expect(isCurrentMonthPeriod({ from: '2026-11-01', to: '2026-11-20' }, today)).toBe(false);
    expect(isCurrentMonthPeriod({ from: '2026-11-01', to: '2026-12-05' }, today)).toBe(false);
    expect(isCurrentMonthPeriod({ from: '2026-10-01', to: '2026-10-31' }, today)).toBe(false);
  });
});
