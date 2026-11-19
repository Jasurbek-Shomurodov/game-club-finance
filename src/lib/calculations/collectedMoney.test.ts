import { describe, expect, it } from 'vitest';
import {
  moneyStillHeld,
  parseCollectedMoneyMoves,
  parseCollectionBalances,
  summarizeCollectedMoney,
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
