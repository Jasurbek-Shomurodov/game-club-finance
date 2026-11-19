import { describe, expect, it } from 'vitest';
import {
  changeRatio,
  lastDueCashDay,
  previousIsoDate,
  collectedFlowByDay,
  dailyCashMonthGlance,
  daysInMonth,
  monthToDateTotal,
  monthlyPairs,
  previousYearMonth,
  recentYearMonths,
  stockGlance,
  type StockGlanceRow,
} from './pageGlance';

describe('month helpers', () => {
  it('steps back across a year boundary', () => {
    expect(previousYearMonth('2026-01')).toBe('2025-12');
    expect(previousYearMonth('2026-11')).toBe('2026-10');
    expect(recentYearMonths('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(recentYearMonths('2026-02', 0)).toEqual([]);
  });
  it('knows month lengths, leap years included', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2026-11')).toBe(30);
  });
  it('rejects a malformed month', () => {
    expect(() => previousYearMonth('2026-13')).toThrow();
  });
});

describe('changeRatio', () => {
  it('is null without a base to compare with', () => {
    expect(changeRatio(150, 100)).toBe(0.5);
    expect(changeRatio(50, -100)).toBe(1.5);
    expect(changeRatio(10, 0)).toBeNull();
    expect(changeRatio(Number.NaN, 5)).toBeNull();
  });
});

describe('dailyCashMonthGlance', () => {
  const entry = (date: string, cash: number, terminal = 0, playstation = 0) => ({
    date, cash_income: cash, terminal_income: terminal, card_income: null, playstation_income: playstation,
  });

  it('totals the month by method and lists the days still missing', () => {
    const glance = dailyCashMonthGlance(
      [entry('2026-11-01', 100, 50), entry('2026-11-03', 200, 0, 30), entry('2026-10-31', 999)],
      '2026-11',
      '2026-11-04',
    );
    expect(glance.total).toBe(380);
    expect(glance.byMethod).toEqual({ cash: 300, terminal: 50, card: 0, playstation: 30 });
    expect(glance.values.get('2026-11-01')).toBe(150);
    expect(glance.missingDates).toEqual(['2026-11-02', '2026-11-04']);
    expect(glance.expectedDays).toBe(4);
    expect(glance.enteredDays).toBe(2);
    expect(glance.averagePerEnteredDay).toBe(190);
    expect(glance.projectedTotal).toBe(190 * 30);
  });

  it('counts a zero entry as entered, not missing', () => {
    const glance = dailyCashMonthGlance([entry('2026-11-01', 0)], '2026-11', '2026-11-01');
    expect(glance.missingDates).toEqual([]);
    expect(glance.enteredDays).toBe(1);
  });

  it('expects every day of a past month and none of a future one', () => {
    const past = dailyCashMonthGlance([entry('2026-10-05', 10)], '2026-10', '2026-11-20');
    expect(past.expectedDays).toBe(31);
    expect(past.missingDates).toHaveLength(30);
    expect(past.projectedTotal).toBe(10);
    const future = dailyCashMonthGlance([], '2026-12', '2026-11-20');
    expect(future.expectedDays).toBe(0);
    expect(future.projectedTotal).toBeNull();
  });
});

describe('monthToDateTotal', () => {
  it('sums only the first days of the month', () => {
    const values = new Map([['2026-10-01', 10], ['2026-10-15', 20], ['2026-10-16', 40], ['2026-09-01', 99]]);
    expect(monthToDateTotal(values, '2026-10', 15)).toBe(30);
    expect(monthToDateTotal(values, '2026-10', 40)).toBe(70);
  });
});

describe('monthlyPairs', () => {
  it('fills months without a row with zeros', () => {
    const pairs = monthlyPairs(['2026-09', '2026-10'], { '2026-10': { a: 5, b: 2 } }, (row) => ({ first: row.a, second: row.b }));
    expect(pairs).toEqual([{ month: '2026-09', first: 0, second: 0 }, { month: '2026-10', first: 5, second: 2 }]);
    const fromMap = monthlyPairs(['2026-10'], new Map([['2026-10', 3]]), (value) => ({ first: value, second: -value }));
    expect(fromMap).toEqual([{ month: '2026-10', first: 3, second: -3 }]);
  });
});

describe('stockGlance', () => {
  const row = (id: string, category: string, previous: number, closing: number, { sale = 10, cost = 4, tracks = true, sold = 0 } = {}): StockGlanceRow => ({
    id,
    name: id.toUpperCase(),
    category,
    input: { tracksInventory: tracks, previousStock: previous, addedToday: 0, closingStock: closing, soldQuantity: sold, salePrice: sale, costPrice: cost },
  });

  it('splits stock value by category and ranks the day’s sellers', () => {
    const glance = stockGlance([
      row('a', 'Drinks', 10, 5),
      row('b', 'Drinks', 4, 4),
      row('c', 'Snacks', 3, 0, { sale: 20 }),
      row('d', 'Kitchen', 0, 0, { tracks: false, sold: 2, sale: 50 }),
    ]);
    expect(glance.valueByCategory).toEqual([{ category: 'Drinks', value: 36 }]);
    expect(glance.topSellers.map((p) => [p.id, p.quantity, p.income])).toEqual([['d', 2, 100], ['c', 3, 60], ['a', 5, 50]]);
    // Made-to-order products never run out.
    expect(glance.outOfStock.map((p) => p.id)).toEqual(['c']);
    expect(glance.lowStock).toEqual([]);
  });

  it('flags products at or under the low-stock line, fewest first', () => {
    const glance = stockGlance([row('x', '', 9, 3), row('y', '', 9, 1), row('z', '', 9, 4)], { lowAt: 3 });
    expect(glance.lowStock.map((p) => [p.id, p.quantity])).toEqual([['y', 1], ['x', 3]]);
  });
});

describe('collectedFlowByDay', () => {
  it('puts collections in and payments or reserve moves out, per day', () => {
    expect(collectedFlowByDay([
      { kind: 'collect', date: '2026-11-02', amount: 500 },
      { kind: 'expense', date: '2026-11-02', amount: -120 },
      { kind: 'reserve', date: '2026-11-01', amount: -80 },
      { kind: 'collect', date: '2026-11-02', amount: 100 },
    ])).toEqual([
      { date: '2026-11-01', collected: 0, out: 80 },
      { date: '2026-11-02', collected: 600, out: 120 },
    ]);
  });
});

describe('lastDueCashDay', () => {
  it('does not expect the open business day until it is entered', () => {
    expect(previousIsoDate('2026-03-01')).toBe('2026-02-28');
    expect(lastDueCashDay('2026-11-19', new Set())).toBe('2026-11-18');
    expect(lastDueCashDay('2026-11-19', new Set(['2026-11-19']))).toBe('2026-11-19');
  });
});
