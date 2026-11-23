import { describe, expect, it } from 'vitest';
import type { DailyCashRow, ExpenseRow } from './dashboardMetrics';
import type { ExpensePreset } from './expensePlans';
import {
  LOW_INCOME_DANGER_RATIO,
  LOW_INCOME_MIN_SAMPLES,
  LOW_INCOME_RATIO,
  SHORTAGE_MIN_COUNT,
  SPIKE_DANGER_RATIO,
  SPIKE_MIN_SHARE,
  SPIKE_RATIO,
  buildMoneyChecks,
  moneyCheckHistoryStart,
  moneyCheckKey,
  sortMoneyChecks,
  type MoneyCheck,
  type MoneyCheckInput,
} from './moneyChecks';

const NOVEMBER = { from: '2026-11-01', to: '2026-11-30' };
/** A day after November: the whole month is finished and counts in full. */
const AFTER_NOVEMBER = '2026-12-05';

let nextId = 0;
const expense = (overrides: Partial<ExpenseRow>): ExpenseRow => ({
  id: `e${(nextId += 1)}`,
  date: '2026-11-10',
  amount: 100_000,
  category: 'repair',
  payment_method: 'cash',
  payment_source: 'game_club',
  comment: null,
  created_at: '2026-11-10T10:00:00Z',
  ...overrides,
});

const cash = (date: string, amount: number): DailyCashRow => ({
  date,
  cash_income: amount,
  terminal_income: 0,
  card_income: 0,
  playstation_income: 0,
});

const preset = (overrides: Partial<ExpensePreset>): ExpensePreset => ({
  id: 'p1',
  name: 'Repair',
  category: 'repair',
  payment_source: 'game_club',
  monthly_amount: 1_000_000,
  sort_order: 0,
  archived_at: null,
  ...overrides,
});

const checks = (overrides: Partial<MoneyCheckInput>): MoneyCheck[] => buildMoneyChecks({
  range: NOVEMBER,
  today: AFTER_NOVEMBER,
  expenseRows: [],
  cashRows: [],
  stockRows: [],
  presets: [],
  ...overrides,
});

const ofKind = (list: MoneyCheck[], kind: MoneyCheck['kind']) => list.filter((check) => check.kind === kind);

describe('moneyCheckHistoryStart', () => {
  it('reaches back three full months, which covers eight weeks', () => {
    expect(moneyCheckHistoryStart(NOVEMBER)).toBe('2026-08-01');
    expect(moneyCheckHistoryStart({ from: '2026-01-01', to: '2026-01-31' })).toBe('2025-10-01');
    // Three months back (1 December) is earlier than eight weeks back (4 January).
    expect(moneyCheckHistoryStart({ from: '2026-03-01', to: '2026-03-31' })).toBe('2025-12-01');
  });
});

describe('buildMoneyChecks', () => {
  it('finds nothing in an empty month or a month that has not started', () => {
    expect(checks({})).toEqual([]);
    expect(checks({ today: '2026-10-31', expenseRows: [expense({}), expense({})] })).toEqual([]);
  });

  describe('duplicate expenses', () => {
    it('flags two identical payments as one danger check', () => {
      const first = expense({});
      const second = expense({});
      const [check] = checks({ expenseRows: [first, second, expense({ amount: 50_000 })] });
      expect(check).toEqual({
        kind: 'duplicate_expense',
        severity: 'danger',
        side: 'game_club',
        date: '2026-11-10',
        range: { from: '2026-11-10', to: '2026-11-10' },
        category: 'repair',
        amount: 100_000,
        count: 2,
        recordIds: [first.id, second.id],
      });
    });

    it('counts every repeated row in the group', () => {
      const [check] = checks({ expenseRows: [expense({}), expense({}), expense({})] });
      expect(check.count).toBe(3);
    });

    it('needs the same date, category, amount, side and method', () => {
      const base = expense({});
      for (const other of [
        expense({ date: '2026-11-11' }),
        expense({ category: 'cleaning' }),
        expense({ amount: 100_001 }),
        expense({ payment_source: 'bar' }),
        expense({ payment_method: 'card' }),
      ]) {
        expect(ofKind(checks({ expenseRows: [base, other] }), 'duplicate_expense')).toEqual([]);
      }
    });

    it('treats an expense without a source as game club money', () => {
      expect(ofKind(checks({ expenseRows: [expense({}), expense({ payment_source: null })] }), 'duplicate_expense')).toHaveLength(1);
    });

    it('leaves salaries, shortages and reserve-paid expenses alone', () => {
      expect(checks({ expenseRows: [expense({ category: 'salary' }), expense({ category: 'salary' })] })).toEqual([]);
      // Two same-amount cash shortages on one day are two shortages, not a duplicate payment.
      expect(ofKind(checks({ expenseRows: [expense({ category: 'shortage' }), expense({ category: 'shortage' })] }), 'duplicate_expense')).toEqual([]);
      expect(checks({ expenseRows: [expense({ paid_from_reserve: true }), expense({ paid_from_reserve: true })] })).toEqual([]);
      expect(checks({ expenseRows: [expense({ payment_method: 'usd' }), expense({ payment_method: 'usd' })] })).toEqual([]);
    });

    it('leaves other months alone', () => {
      expect(checks({ expenseRows: [expense({ date: '2026-10-10' }), expense({ date: '2026-10-10' })] })).toEqual([]);
    });
  });

  describe('category spikes', () => {
    // Repair: 1 000 000 in each of the three months before November.
    const history = ['2026-08-15', '2026-09-15', '2026-10-15'].map((date) => expense({ date, amount: 1_000_000 }));
    // Rent keeps the side's month large enough for the share rule to be met by a 500 000 excess.
    const rent = expense({ category: 'rent', amount: 5_000_000, date: '2026-11-02' });
    const repair = (amount: number) => expense({ amount, date: '2026-11-20' });

    it('flags a category at its threshold', () => {
      const [check] = ofKind(checks({ expenseRows: [...history, rent, repair(1_000_000 * SPIKE_RATIO)] }), 'category_spike');
      expect(check).toMatchObject({
        severity: 'warning',
        side: 'game_club',
        date: null,
        range: NOVEMBER,
        category: 'repair',
        amount: 1_500_000,
        usual: 1_000_000,
      });
    });

    it('does not flag a category just below it', () => {
      expect(ofKind(checks({ expenseRows: [...history, rent, repair(1_490_000)] }), 'category_spike')).toEqual([]);
    });

    it('is danger at twice the threshold', () => {
      const [check] = ofKind(checks({ expenseRows: [...history, rent, repair(1_000_000 * SPIKE_DANGER_RATIO)] }), 'category_spike');
      expect(check.severity).toBe('danger');
    });

    it('needs the excess to be a real share of the side month', () => {
      // 500 000 over usual is under 5% of a 21.5 million month.
      const bigRent = expense({ category: 'rent', amount: 20_000_000, date: '2026-11-02' });
      expect((1_500_000 - 1_000_000) / (21_500_000)).toBeLessThan(SPIKE_MIN_SHARE);
      expect(ofKind(checks({ expenseRows: [...history, bigRent, repair(1_500_000)] }), 'category_spike')).toEqual([]);
    });

    it('needs the category in at least two of the three earlier months', () => {
      const oneMonth = [expense({ date: '2026-10-15', amount: 3_000_000 })];
      expect(ofKind(checks({ expenseRows: [...oneMonth, rent, repair(3_000_000)] }), 'category_spike')).toEqual([]);
      // Two months average over three: (1.2m + 1.2m) / 3 = 800 000 usual.
      const twoMonths = ['2026-09-15', '2026-10-15'].map((date) => expense({ date, amount: 1_200_000 }));
      const [check] = ofKind(checks({ expenseRows: [...twoMonths, rent, repair(1_200_000)] }), 'category_spike');
      expect(check.usual).toBe(800_000);
    });

    it('compares with what the earlier months had spent by the same day', () => {
      // Each earlier month: 500 000 on the 5th, 500 000 on the 25th. By the 15th that is 500 000.
      const split = ['2026-08', '2026-09', '2026-10'].flatMap((month) => [
        expense({ date: `${month}-05`, amount: 500_000 }),
        expense({ date: `${month}-25`, amount: 500_000 }),
      ]);
      const smallRent = expense({ category: 'rent', amount: 2_000_000, date: '2026-11-02' });
      const [check] = ofKind(checks({ today: '2026-11-15', expenseRows: [...split, smallRent, expense({ amount: 750_000, date: '2026-11-05' })] }), 'category_spike');
      expect(check).toMatchObject({ usual: 500_000, amount: 750_000, range: { from: '2026-11-01', to: '2026-11-15' } });
    });

    it('does not flag a usual lump payment early in the month', () => {
      // Rent of 5 000 000 paid on the 2nd every month; on the 3rd it is not a spike.
      const rentHistory = ['2026-08-02', '2026-09-02', '2026-10-02'].map((date) => expense({ category: 'rent', date, amount: 5_000_000 }));
      expect(ofKind(checks({ today: '2026-11-03', expenseRows: [...rentHistory, expense({ category: 'rent', date: '2026-11-02', amount: 5_000_000 })] }), 'category_spike')).toEqual([]);
    });

    it('flags a lump payment early in the month that is well above usual', () => {
      const rentHistory = ['2026-08-02', '2026-09-02', '2026-10-02'].map((date) => expense({ category: 'rent', date, amount: 5_000_000 }));
      const [check] = ofKind(checks({ today: '2026-11-03', expenseRows: [...rentHistory, expense({ category: 'rent', date: '2026-11-02', amount: 8_000_000 })] }), 'category_spike');
      expect(check).toMatchObject({ category: 'rent', severity: 'warning', amount: 8_000_000, usual: 5_000_000, range: { from: '2026-11-01', to: '2026-11-03' } });
    });

    it('leaves reserve-paid expenses out of the categories and the side totals', () => {
      // A large repair paid from the reserve or in dollars is not side money.
      for (const paid of [{ paid_from_reserve: true }, { payment_method: 'usd' }]) {
        expect(ofKind(checks({ expenseRows: [...history, rent, expense({ amount: 3_000_000, date: '2026-11-20', ...paid })] }), 'category_spike')).toEqual([]);
      }
      // A reserve-paid rent does not inflate the side month, so a 500 000 excess still counts.
      const reserveRent = expense({ category: 'rent', amount: 20_000_000, date: '2026-11-03', paid_from_reserve: true });
      expect(ofKind(checks({ expenseRows: [...history, rent, reserveRent, repair(1_500_000)] }), 'category_spike')).toHaveLength(1);
    });

    it('leaves a planned category to the plan panel, but not an archived plan', () => {
      const rows = [...history, rent, repair(2_000_000)];
      expect(ofKind(checks({ expenseRows: rows, presets: [preset({})] }), 'category_spike')).toEqual([]);
      expect(ofKind(checks({ expenseRows: rows, presets: [preset({ payment_source: 'bar' })] }), 'category_spike')).toHaveLength(1);
      expect(ofKind(checks({ expenseRows: rows, presets: [preset({ archived_at: '2026-10-01T00:00:00Z' })] }), 'category_spike')).toHaveLength(1);
    });

    it('keeps the two sides apart', () => {
      // The bar paid repair in earlier months; the game club did not.
      const barHistory = history.map((row) => ({ ...row, payment_source: 'bar' as const }));
      expect(ofKind(checks({ expenseRows: [...barHistory, rent, repair(3_000_000)] }), 'category_spike')).toEqual([]);
    });

    it('leaves shortages to their own check', () => {
      const shortages = history.map((row) => ({ ...row, category: 'shortage' }));
      expect(ofKind(checks({ expenseRows: [...shortages, rent, expense({ category: 'shortage', amount: 3_000_000 })] }), 'category_spike')).toEqual([]);
    });
  });

  describe('low income days', () => {
    // Monday 16 November against the eight Mondays before it, each 1 000 000.
    const day = '2026-11-16';
    const mondays = ['2026-11-09', '2026-11-02', '2026-10-26', '2026-10-19', '2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21'];
    const usualRows = mondays.map((date) => cash(date, 1_000_000));

    it('flags a finished day under its threshold', () => {
      const [check] = checks({ cashRows: [...usualRows, cash(day, 590_000)] });
      expect(check).toEqual({
        kind: 'low_income_day',
        severity: 'warning',
        side: 'game_club',
        date: day,
        range: { from: day, to: day },
        amount: 590_000,
        usual: 1_000_000,
      });
    });

    it('does not flag a day at the threshold', () => {
      expect(checks({ cashRows: [...usualRows, cash(day, 1_000_000 * LOW_INCOME_RATIO)] })).toEqual([]);
    });

    it('is danger twice as far below', () => {
      const [check] = checks({ cashRows: [...usualRows, cash(day, 1_000_000 * LOW_INCOME_DANGER_RATIO - 1)] });
      expect(check.severity).toBe('danger');
    });

    it('adds the rows of one day together', () => {
      expect(checks({ cashRows: [...usualRows, cash(day, 300_000), cash(day, 400_000)] })).toEqual([]);
    });

    it('needs enough weeks of history', () => {
      const few = usualRows.slice(0, LOW_INCOME_MIN_SAMPLES - 1);
      expect(checks({ cashRows: [...few, cash(day, 100_000)] })).toEqual([]);
      const enough = usualRows.slice(0, LOW_INCOME_MIN_SAMPLES);
      expect(checks({ cashRows: [...enough, cash(day, 100_000)] })).toHaveLength(1);
    });

    it('never flags a day without an entry or today', () => {
      expect(checks({ cashRows: usualRows })).toEqual([]);
      expect(checks({ today: day, cashRows: [...usualRows, cash(day, 100_000)] })).toEqual([]);
      // The first day of a month is today, so it is not judged either.
      expect(checks({ today: '2026-11-01', cashRows: [...usualRows, cash('2026-11-01', 0)] })).toEqual([]);
    });

    it('checks bar sales as a separate bar check', () => {
      const stockRows = [...mondays.map((date) => ({ date, bar_income: 400_000 })), { date: day, bar_income: 100_000 }];
      const [check] = checks({ cashRows: [...usualRows, cash(day, 1_000_000)], stockRows });
      expect(check).toMatchObject({ kind: 'low_income_day', side: 'bar', amount: 100_000, usual: 400_000 });
    });
  });

  describe('repeated shortages', () => {
    const shortage = (date: string, amount = 50_000, payment_source: 'game_club' | 'bar' = 'game_club') =>
      expense({ category: 'shortage', date, amount, payment_source, payment_method: 'cash', created_at: `${date}T${String(nextId % 24).padStart(2, '0')}:00:00Z` });

    it('flags three shortages in the month', () => {
      const [check] = checks({ expenseRows: [shortage('2026-11-03'), shortage('2026-11-10', 70_000), shortage('2026-11-20')] });
      expect(check).toEqual({
        kind: 'repeated_shortage',
        severity: 'warning',
        side: 'game_club',
        date: null,
        range: { from: '2026-11-01', to: '2026-11-20' },
        category: 'shortage',
        amount: 170_000,
        count: SHORTAGE_MIN_COUNT,
      });
    });

    it('does not flag two, and keeps the sides apart', () => {
      expect(checks({ expenseRows: [shortage('2026-11-03'), shortage('2026-11-10', 70_000)] })).toEqual([]);
      expect(checks({ expenseRows: [shortage('2026-11-03'), shortage('2026-11-10', 70_000), shortage('2026-11-20', 50_000, 'bar')] })).toEqual([]);
    });

    it('flags three recorded days in a row, even across the month start', () => {
      const cashRows = ['2026-10-30', '2026-10-31', '2026-11-01'].map((date) => cash(date, 1_000_000));
      const [check] = checks({ cashRows, expenseRows: [shortage('2026-10-30'), shortage('2026-10-31', 70_000), shortage('2026-11-01')] });
      expect(check).toMatchObject({ kind: 'repeated_shortage', range: { from: '2026-10-30', to: '2026-11-01' }, count: 3, amount: 170_000 });
    });

    it('counts recorded days, so a day without an entry does not break the run', () => {
      // No entries on 1 or 3 November: 31 October, 2 and 4 November are three recorded days in a row.
      const cashRows = ['2026-10-31', '2026-11-02', '2026-11-04'].map((date) => cash(date, 1_000_000));
      const rows = [shortage('2026-10-31'), shortage('2026-11-02'), shortage('2026-11-04')];
      expect(ofKind(checks({ cashRows, expenseRows: rows }), 'repeated_shortage')).toHaveLength(1);
      // A recorded day without a shortage in between does break it.
      const broken = [...cashRows, cash('2026-11-03', 1_000_000)];
      expect(ofKind(checks({ cashRows: broken, expenseRows: rows }), 'repeated_shortage')).toEqual([]);
    });

    it('ignores a run that ended before the month', () => {
      const cashRows = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-11-05'].map((date) => cash(date, 1_000_000));
      const rows = [shortage('2026-10-01'), shortage('2026-10-02'), shortage('2026-10-03'), shortage('2026-11-05')];
      expect(ofKind(checks({ cashRows, expenseRows: rows }), 'repeated_shortage')).toEqual([]);
    });
  });
});

describe('sortMoneyChecks', () => {
  const check = (overrides: Partial<MoneyCheck>): MoneyCheck => ({
    kind: 'low_income_day',
    severity: 'warning',
    side: 'game_club',
    date: '2026-11-10',
    range: { from: '2026-11-10', to: '2026-11-10' },
    amount: 100,
    ...overrides,
  });

  it('puts danger first, then the newest, then the largest', () => {
    const sorted = sortMoneyChecks([
      check({ amount: 1 }),
      check({ date: '2026-11-12' }),
      check({ severity: 'danger', date: '2026-11-01' }),
      check({ amount: 500 }),
      check({ date: null, range: { from: '2026-11-01', to: '2026-11-11' } }),
    ]);
    expect(sorted.map((row) => [row.severity, row.date ?? row.range.to, row.amount])).toEqual([
      ['danger', '2026-11-01', 100],
      ['warning', '2026-11-12', 100],
      ['warning', '2026-11-11', 100],
      ['warning', '2026-11-10', 500],
      ['warning', '2026-11-10', 1],
    ]);
  });
});

describe('moneyCheckKey', () => {
  it('tells apart duplicate groups that differ only by payment method', () => {
    const rows = [expense({}), expense({}), expense({ payment_method: 'card' }), expense({ payment_method: 'card' })];
    const found = ofKind(checks({ expenseRows: rows }), 'duplicate_expense');
    expect(found).toHaveLength(2);
    expect(new Set(found.map(moneyCheckKey)).size).toBe(2);
  });
});
