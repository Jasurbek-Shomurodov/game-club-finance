import { describe, expect, it } from 'vitest';
import {
  collectedMovesHeldOn,
  collectedMovesWithin,
  isCurrentMonthPeriod,
  monthToDateRange,
  moneyStillHeld,
  moneyStillHeldByMethod,
  parseCollectedMoneyMoves,
  parseCollectionBalances,
  periodCoversMoneyNow,
  summarizeCollectedMoney,
  summarizeCollectedMoneyThrough,
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

  it('reuses a period\'s own figures only when it ends in today\'s month on or after today', () => {
    expect(periodCoversMoneyNow({ from: '2026-11-01', to: '2026-11-30' }, today)).toBe(true);
    expect(periodCoversMoneyNow({ from: '2026-11-10', to: today }, today)).toBe(true);
    // Starts last month: its cards and collected money still count from 1 November.
    expect(periodCoversMoneyNow({ from: '2026-10-15', to: today }, today)).toBe(true);
    // Ends before today: the days since are missing.
    expect(periodCoversMoneyNow({ from: '2026-11-01', to: '2026-11-20' }, today)).toBe(false);
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

describe('collected money held at a period end', () => {
  const moves = [
    move({ id: 'r1', date: '2026-10-20', method: 'cash', amount: 1_500_000, createdAt: '2026-10-20T10:00:00Z' }),
    move({ kind: 'expense', id: 'e1', date: '2026-10-22', method: 'cash', amount: -400_000, createdAt: '2026-10-22T10:00:00Z' }),
    move({ id: 'r2', date: '2026-11-03', method: 'cash', amount: 700_000, createdAt: '2026-11-03T10:00:00Z' }),
    move({ kind: 'reserve', id: 'v1', date: '2026-11-04', method: 'cash', amount: -200_000, createdAt: '2026-11-04T10:00:00Z' }),
    move({ id: 'r3', date: '2026-11-05', method: 'card', amount: 100_000, createdAt: '2026-11-05T10:00:00Z' }),
  ];

  it('keeps only the moves of the period end\'s month, through that day', () => {
    expect(collectedMovesHeldOn(moves, '2026-11-30').map((entry) => entry.id)).toEqual(['r2', 'v1', 'r3']);
    expect(collectedMovesHeldOn(moves, '2026-11-04').map((entry) => entry.id)).toEqual(['r2', 'v1']);
    expect(collectedMovesHeldOn(moves, '2026-10-31').map((entry) => entry.id)).toEqual(['r1', 'e1']);
  });

  it('counts held for a cross-month period from the 1st of its last month only', () => {
    // 12 Oct - 30 Nov: October's 1 100 000 still held on 31 Oct was reset on 1 November.
    const summary = summarizeCollectedMoneyThrough(moves, { from: '2026-10-12', to: '2026-11-30' });
    expect(summary.held).toEqual({ cash: 500_000, terminal: 0, card: 100_000, playstation: 0, total: 600_000 });
    // What was collected, spent and moved covers the whole period.
    expect(summary.collected.total).toBe(2_300_000);
    expect(summary.spent.total).toBe(400_000);
    expect(summary.toReserve.total).toBe(200_000);
    expect(summary.collections).toHaveLength(3);
  });

  it('counts collected, spent, moved and the collections only within the period', () => {
    // Fetched from 1 October; the period is 21 Oct - 4 Nov.
    const summary = summarizeCollectedMoneyThrough(moves, { from: '2026-10-21', to: '2026-11-04' });
    expect(summary.collected.total).toBe(700_000);
    expect(summary.spent.total).toBe(400_000);
    expect(summary.toReserve.total).toBe(200_000);
    expect(summary.collections.map((group) => group.id)).toEqual(['r2']);
    // Held is still the balance on 4 November, counted from 1 November.
    expect(summary.held.total).toBe(500_000);
  });

  it('keeps held counted from the 1st when a period starts mid-month', () => {
    // 5 - 30 Nov: only card was collected in the period's own days, yet 3 Nov's cash is still held.
    const summary = summarizeCollectedMoneyThrough(moves, { from: '2026-11-05', to: '2026-11-30' });
    expect(summary.collected).toEqual({ cash: 0, terminal: 0, card: 100_000, playstation: 0, total: 100_000 });
    expect(summary.toReserve.total).toBe(0);
    expect(summary.held).toEqual({ cash: 500_000, terminal: 0, card: 100_000, playstation: 0, total: 600_000 });
  });

  it('is the plain summary for a whole month', () => {
    const november = moves.slice(2);
    expect(summarizeCollectedMoneyThrough(november, { from: '2026-11-01', to: '2026-11-30' })).toEqual(summarizeCollectedMoney(november));
  });

  it('keeps the moves dated within a period, both ends included', () => {
    expect(collectedMovesWithin(moves, { from: '2026-10-22', to: '2026-11-04' }).map((entry) => entry.id)).toEqual(['e1', 'r2', 'v1']);
    expect(collectedMovesWithin(moves, { from: '2026-12-01', to: '2026-12-31' })).toEqual([]);
  });
});
