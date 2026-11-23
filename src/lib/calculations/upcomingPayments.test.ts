import { describe, expect, it } from 'vitest';
import { buildExpensePlanSummary, type ExpensePreset, type PresetExpenseRow } from './expensePlans';
import {
  buildUpcomingPayments,
  planSuggestionHistoryStart,
  planSuggestionRange,
  suggestExpensePlans,
  usualDayHistoryStart,
  type PlanSuggestionInput,
} from './upcomingPayments';

const preset = (overrides: Partial<ExpensePreset>): ExpensePreset => ({
  id: 'p1',
  name: 'Rent',
  category: 'rent',
  payment_source: 'game_club',
  monthly_amount: 3_000_000,
  sort_order: 0,
  archived_at: null,
  ...overrides,
});

const range = { from: '2026-11-01', to: '2026-11-30' };

function upcoming(presets: ExpensePreset[], linked: PresetExpenseRow[], today = '2026-11-20', month = range) {
  return buildUpcomingPayments({
    summary: buildExpensePlanSummary(presets, linked, month),
    linkedExpenses: linked,
    range: month,
    today,
  });
}

const paid = (date: string, amount: number, presetId = 'p1'): PresetExpenseRow => ({ date, amount, preset_id: presetId });

describe('history windows', () => {
  it('reads six months of linked payments and four full months of expenses', () => {
    expect(usualDayHistoryStart(range)).toBe('2026-05-01');
    expect(planSuggestionHistoryStart(range)).toBe('2026-07-01');
    expect(planSuggestionHistoryStart({ from: '2026-02-01', to: '2026-02-28' })).toBe('2025-10-01');
    expect(planSuggestionRange({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2025-11-01', to: '2026-02-28' });
  });
});

describe('buildUpcomingPayments', () => {
  it('lists what is still due with the median day of the last six payments', () => {
    const linked = [
      paid('2026-04-01', 3_000_000), // the seventh-latest: ignored
      paid('2026-05-10', 3_000_000),
      paid('2026-06-11', 3_000_000),
      paid('2026-07-12', 3_000_000),
      paid('2026-08-12', 3_000_000),
      paid('2026-09-13', 3_000_000),
      paid('2026-10-14', 3_000_000),
    ];
    const result = upcoming([preset({})], linked, '2026-11-05');
    expect(result.gameClub.rows).toHaveLength(1);
    expect(result.gameClub.rows[0]).toMatchObject({ remaining: 3_000_000, usualDay: 12, dueDate: '2026-11-12', overdue: false });
    expect(result.gameClub.remaining).toBe(3_000_000);
    expect(result.bar).toEqual({ rows: [], remaining: 0 });
  });

  it('is overdue once the due date has passed with money still due, never on the due day itself', () => {
    const linked = [paid('2026-10-12', 3_000_000)];
    expect(upcoming([preset({})], linked, '2026-11-13').gameClub.rows[0].overdue).toBe(true);
    expect(upcoming([preset({})], linked, '2026-11-12').gameClub.rows[0].overdue).toBe(false);
  });

  it('floors what is left at zero and is not overdue once paid', () => {
    const linked = [paid('2026-10-05', 3_000_000), paid('2026-11-04', 3_500_000)];
    const row = upcoming([preset({})], linked, '2026-11-20').gameClub.rows[0];
    expect(row).toMatchObject({ remaining: 0, overdue: false, dueDate: '2026-11-05' });
  });

  it('counts a partly paid plan by what is left', () => {
    const result = upcoming([preset({})], [paid('2026-11-02', 1_000_000)], '2026-11-03');
    expect(result.gameClub.remaining).toBe(2_000_000);
  });

  it('has no due date and is never overdue without any linked payment', () => {
    const row = upcoming([preset({})], [], '2026-11-30').gameClub.rows[0];
    expect(row).toMatchObject({ remaining: 3_000_000, usualDay: null, dueDate: null, overdue: false });
  });

  it('clamps the usual day to the last day of a short month', () => {
    const february = { from: '2026-02-01', to: '2026-02-28' };
    const linked = [paid('2025-12-31', 3_000_000), paid('2026-01-31', 3_000_000)];
    const row = upcoming([preset({})], linked, '2026-02-10', february).gameClub.rows[0];
    expect(row).toMatchObject({ usualDay: 31, dueDate: '2026-02-28' });
  });

  it('keeps the sides apart and skips archived plans', () => {
    const presets = [
      preset({}),
      preset({ id: 'p2', name: 'Cleaning', category: 'cleaning', payment_source: 'bar', monthly_amount: 400_000 }),
      preset({ id: 'p3', name: 'Old', archived_at: '2026-10-01T00:00:00Z' }),
    ];
    const result = upcoming(presets, [paid('2026-11-02', 100_000, 'p3')], '2026-11-03');
    expect(result.gameClub.rows.map((row) => row.preset.id)).toEqual(['p1']);
    expect(result.gameClub.remaining).toBe(3_000_000);
    expect(result.bar.rows.map((row) => row.preset.id)).toEqual(['p2']);
    expect(result.bar.remaining).toBe(400_000);
  });

  it('has nothing upcoming for a past month', () => {
    const october = { from: '2026-10-01', to: '2026-10-31' };
    expect(upcoming([preset({})], [], '2026-11-20', october)).toEqual({
      gameClub: { rows: [], remaining: 0 },
      bar: { rows: [], remaining: 0 },
    });
  });

  it('works on the first day of the month', () => {
    const row = upcoming([preset({})], [paid('2026-10-01', 3_000_000)], '2026-11-01').gameClub.rows[0];
    expect(row).toMatchObject({ dueDate: '2026-11-01', overdue: false, remaining: 3_000_000 });
  });
});

type Row = PlanSuggestionInput['expenseRows'][number];
const expense = (date: string, amount: number, overrides: Partial<Row> = {}): Row => ({
  date,
  amount,
  category: 'internet',
  payment_source: 'game_club',
  payment_method: 'cash',
  ...overrides,
});

describe('suggestExpensePlans', () => {
  const steady = [
    expense('2026-07-03', 500_000),
    expense('2026-08-04', 520_000),
    expense('2026-09-05', 480_000),
    expense('2026-10-04', 510_000),
  ];

  it('suggests a regular expense without a plan, at its median rounded to 1 000', () => {
    expect(suggestExpensePlans({ range, expenseRows: steady, presets: [] })).toEqual([
      { category: 'internet', side: 'game_club', typicalAmount: 505_000, months: 4, usualDay: 4 },
    ]);
  });

  it('needs three of the last four full months', () => {
    expect(suggestExpensePlans({ range, expenseRows: steady.slice(1), presets: [] })).toHaveLength(1);
    expect(suggestExpensePlans({ range, expenseRows: steady.slice(2), presets: [] })).toEqual([]);
  });

  it('ignores the selected month and anything before the four months', () => {
    const rows = [expense('2026-06-30', 500_000), expense('2026-11-02', 500_000), ...steady.slice(2)];
    expect(suggestExpensePlans({ range, expenseRows: rows, presets: [] })).toEqual([]);
  });

  it('needs every month within 25% of the median', () => {
    const within = [...steady.slice(0, 3), expense('2026-10-04', 620_000)]; // median 510 000; 620 000 is +21.6%
    expect(suggestExpensePlans({ range, expenseRows: within, presets: [] })).toHaveLength(1);
    const beyond = [...steady.slice(0, 3), expense('2026-10-04', 700_000)]; // median 510 000; 700 000 is +37%
    expect(suggestExpensePlans({ range, expenseRows: beyond, presets: [] })).toEqual([]);
  });

  it('adds up a month before comparing it', () => {
    const rows = [
      expense('2026-08-02', 250_000), expense('2026-08-20', 250_000),
      expense('2026-09-03', 500_000),
      expense('2026-10-03', 500_000),
    ];
    expect(suggestExpensePlans({ range, expenseRows: rows, presets: [] })[0]).toMatchObject({ typicalAmount: 500_000, months: 3 });
  });

  it('leaves out a category with a live plan on that side, but not one whose plan is archived', () => {
    expect(suggestExpensePlans({ range, expenseRows: steady, presets: [preset({ category: 'internet' })] })).toEqual([]);
    expect(suggestExpensePlans({ range, expenseRows: steady, presets: [preset({ category: 'internet', payment_source: 'bar' })] })).toHaveLength(1);
    expect(suggestExpensePlans({ range, expenseRows: steady, presets: [preset({ category: 'internet', archived_at: '2026-01-01T00:00:00Z' })] })).toHaveLength(1);
  });

  it('exempts salaries, shortages, non-running costs and reserve-paid expenses', () => {
    const as = (overrides: Partial<Row>) => steady.map((row) => ({ ...row, ...overrides }));
    for (const category of ['salary', 'shortage', 'correction', 'discount', 'investments']) {
      expect(suggestExpensePlans({ range, expenseRows: as({ category }), presets: [] })).toEqual([]);
    }
    expect(suggestExpensePlans({ range, expenseRows: as({ paid_from_reserve: true }), presets: [] })).toEqual([]);
    expect(suggestExpensePlans({ range, expenseRows: as({ payment_method: 'usd' }), presets: [] })).toEqual([]);
  });

  it('keeps the sides apart and suggests only categories the side can plan', () => {
    const bar = (category: string) => steady.map((row) => ({ ...row, category, payment_source: 'bar' as const }));
    expect(suggestExpensePlans({ range, expenseRows: bar('cleaning'), presets: [] })).toEqual([
      expect.objectContaining({ category: 'cleaning', side: 'bar' }),
    ]);
    // Bar money pays only for cleaning and food/drinks.
    expect(suggestExpensePlans({ range, expenseRows: bar('rent'), presets: [] })).toEqual([]);
    // Half bar, half game club: neither side has three months.
    const split = steady.map((row, index) => ({ ...row, payment_source: index % 2 ? 'bar' as const : 'game_club' as const, category: 'cleaning' }));
    expect(suggestExpensePlans({ range, expenseRows: split, presets: [] })).toEqual([]);
  });

  it('lists the largest first, at most three per side', () => {
    const categories = ['internet', 'electricity', 'rent', 'marketing'];
    const rows = categories.flatMap((category, index) => steady.map((row) => ({ ...row, category, amount: row.amount * (index + 1) })));
    expect(suggestExpensePlans({ range, expenseRows: rows, presets: [] }).map((row) => row.category)).toEqual(['marketing', 'rent', 'electricity']);
  });

  it('suggests nothing for a club with little history', () => {
    expect(suggestExpensePlans({ range, expenseRows: [], presets: [] })).toEqual([]);
  });
});
