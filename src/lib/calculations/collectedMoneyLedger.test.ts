import { describe, expect, it } from 'vitest';
import {
  buildCollectedLedger,
  buildCollectedLedgerWithin,
  sumCollectedRows,
  summarizeByCollector,
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

const moves = [
  move({ id: 'r1', date: '2026-11-02', method: 'cash', amount: 2_000_000, createdAt: '2026-11-02T10:00:00Z' }),
  move({ id: 'r1', date: '2026-11-02', method: 'card', amount: 500_000, createdAt: '2026-11-02T10:00:00Z' }),
  move({ kind: 'expense', id: 'e1', date: '2026-11-03', method: 'cash', amount: -1_500_000, createdBy: 'u3' }),
  move({ id: 'r2', date: '2026-11-04', method: 'terminal', amount: 1_000_000, createdBy: 'u2', createdAt: '2026-11-04T09:00:00Z' }),
  move({ kind: 'reserve', id: 'v1', date: '2026-11-05', method: 'card', amount: -200_000, createdAt: '2026-11-05T09:00:00Z' }),
  move({ id: 'r3', date: '2026-11-06', method: 'cash', amount: 300_000, createdAt: '2026-11-06T09:00:00Z' }),
];

describe('buildCollectedLedger', () => {
  it('groups a collect into one line, signs amounts and keeps a running balance, newest first', () => {
    const ledger = buildCollectedLedger(moves);
    expect(ledger.map((line) => [line.kind, line.id, line.total, line.heldAfter])).toEqual([
      ['collect', 'r3', 300_000, 2_100_000],
      ['reserve', 'v1', -200_000, 1_800_000],
      ['collect', 'r2', 1_000_000, 2_000_000],
      ['expense', 'e1', -1_500_000, 1_000_000],
      ['collect', 'r1', 2_500_000, 2_500_000],
    ]);
    expect(ledger[4]).toMatchObject({ cash: 2_000_000, card: 500_000, terminal: 0 });
    expect(ledger[0].heldAfter).toBe(summarizeCollectedMoney(moves).held.total);
  });

  it('orders by date, then save time, whatever order the moves came in', () => {
    const ledger = buildCollectedLedger([...moves].reverse());
    expect(ledger.map((line) => line.id)).toEqual(['r3', 'v1', 'r2', 'e1', 'r1']);
  });

  it('is empty without moves', () => {
    expect(buildCollectedLedger([])).toEqual([]);
  });
});

describe('summarizeByCollector', () => {
  it('sums each collector, the largest first, with a count and the last date', () => {
    const totals = summarizeByCollector(summarizeCollectedMoney(moves).collections);
    expect(totals.map((row) => [row.collectorId, row.total, row.count, row.lastDate])).toEqual([
      ['u1', 2_800_000, 2, '2026-11-06'],
      ['u2', 1_000_000, 1, '2026-11-04'],
    ]);
    expect(totals[0]).toMatchObject({ cash: 2_300_000, card: 500_000 });
  });

  it('keeps collections without a known collector together', () => {
    const totals = summarizeByCollector(summarizeCollectedMoney([
      move({ id: 'a', amount: 100, createdBy: null }),
      move({ id: 'b', amount: 50, createdBy: null }),
    ]).collections);
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ collectorId: null, total: 150, count: 2 });
  });
});

describe('sumCollectedRows', () => {
  it('adds per method and in total', () => {
    const ledger = buildCollectedLedger(moves);
    expect(sumCollectedRows(ledger)).toEqual({ cash: 800_000, terminal: 1_000_000, card: 300_000, playstation: 0, total: 2_100_000 });
    expect(sumCollectedRows([]).total).toBe(0);
  });
});

describe('collected ledger across months', () => {
  it('starts the running balance again on the 1st', () => {
    const ledger = buildCollectedLedger([
      move({ id: 'r1', date: '2026-10-20', method: 'cash', amount: 1_000_000, createdAt: '2026-10-20T10:00:00Z' }),
      move({ kind: 'expense', id: 'e1', date: '2026-10-25', method: 'cash', amount: -300_000, createdAt: '2026-10-25T10:00:00Z' }),
      move({ id: 'r2', date: '2026-11-02', method: 'cash', amount: 400_000, createdAt: '2026-11-02T10:00:00Z' }),
    ]);
    expect(ledger.map((line) => [line.id, line.heldAfter])).toEqual([['r2', 400_000], ['e1', 700_000], ['r1', 1_000_000]]);
  });
});

describe('collected ledger within a period', () => {
  it('shows only the period\'s lines with the running balance of every move', () => {
    const ledger = buildCollectedLedgerWithin([
      move({ id: 'r1', date: '2026-11-02', method: 'cash', amount: 1_000_000, createdAt: '2026-11-02T10:00:00Z' }),
      move({ kind: 'expense', id: 'e1', date: '2026-11-12', method: 'cash', amount: -300_000, createdAt: '2026-11-12T10:00:00Z' }),
      move({ id: 'r2', date: '2026-11-15', method: 'cash', amount: 400_000, createdAt: '2026-11-15T10:00:00Z' }),
      move({ id: 'r3', date: '2026-11-25', method: 'cash', amount: 50_000, createdAt: '2026-11-25T10:00:00Z' }),
    ], { from: '2026-11-12', to: '2026-11-20' });
    // 2 Nov's collect is before the period: not listed, but still in the balance.
    expect(ledger.map((line) => [line.id, line.heldAfter])).toEqual([['r2', 1_100_000], ['e1', 700_000]]);
  });
});
