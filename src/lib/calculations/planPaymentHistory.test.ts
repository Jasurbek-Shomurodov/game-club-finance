import { describe, expect, it } from 'vitest';
import { buildExpensePlanSummary, type ExpensePreset, type PresetExpenseRow } from './expensePlans';
import { buildPlanPaymentHistory, PLAN_HISTORY_MONTHS, planHistoryStart } from './planPaymentHistory';

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

const paid = (date: string, amount: number, presetId = 'p1'): PresetExpenseRow => ({ date, amount, preset_id: presetId });

const march = { from: '2026-03-01', to: '2026-03-31' };
const november = { from: '2026-11-01', to: '2026-11-30' };

function history(presets: ExpensePreset[], linked: PresetExpenseRow[], range = november) {
  return buildPlanPaymentHistory({ summary: buildExpensePlanSummary(presets, linked, range), linkedExpenses: linked, range });
}

describe('planHistoryStart', () => {
  it('starts five months before the selected month', () => {
    expect(planHistoryStart(november)).toBe('2026-06-01');
    expect(planHistoryStart(march)).toBe('2025-10-01');
  });
});

describe('buildPlanPaymentHistory', () => {
  it('shows six months ending with the selected one, across a year boundary', () => {
    const result = history([preset({})], [], march);
    expect(result.months).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
    expect(result.months).toHaveLength(PLAN_HISTORY_MONTHS);
    const cells = result.gameClub.rows[0].cells;
    expect(cells).toHaveLength(PLAN_HISTORY_MONTHS);
    expect(cells[0].range).toEqual({ from: '2025-10-01', to: '2025-10-31' });
    expect(cells[4].range).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(cells[5].range).toEqual(march);
  });

  it('sums payments per month and per plan', () => {
    const presets = [preset({}), preset({ id: 'p2', name: 'Internet', category: 'internet', sort_order: 1 })];
    const result = history(presets, [
      paid('2026-09-05', 2_000_000),
      paid('2026-09-20', 1_000_000),
      paid('2026-11-03', 3_000_000),
      paid('2026-10-10', 400_000, 'p2'),
    ]);
    const [rent, internet] = result.gameClub.rows;
    expect(rent.cells.map((cell) => cell.paid)).toEqual([0, 0, 0, 3_000_000, 0, 3_000_000]);
    expect(rent.cells.map((cell) => cell.count)).toEqual([0, 0, 0, 2, 0, 1]);
    expect(rent.paidMonths).toBe(2);
    expect(internet.cells.map((cell) => cell.paid)).toEqual([0, 0, 0, 0, 400_000, 0]);
    expect(internet.paidMonths).toBe(1);
  });

  it('ignores payments outside the window and unlinked rows', () => {
    const result = history([preset({})], [
      paid('2026-05-31', 9_000_000),
      paid('2026-12-01', 9_000_000),
      { date: '2026-08-01', amount: 9_000_000, preset_id: null },
      paid('2026-06-01', 100),
      paid('2026-11-30', 200),
    ]);
    expect(result.gameClub.rows[0].cells.map((cell) => cell.paid)).toEqual([100, 0, 0, 0, 0, 200]);
  });

  it('keeps the rows and order of the summary, archived plans included only when it has them', () => {
    const presets = [
      preset({ id: 'b', name: 'B plan', sort_order: 2 }),
      preset({ id: 'a', name: 'A plan', sort_order: 1 }),
      preset({ id: 'old', name: 'Old', archived_at: '2026-10-01T00:00:00Z', sort_order: 0 }),
      preset({ id: 'gone', name: 'Gone', archived_at: '2026-08-01T00:00:00Z', sort_order: 3 }),
    ];
    // "Gone" was paid only before the selected month, so the summary (and the history) leaves it out.
    const result = history(presets, [paid('2026-11-02', 50_000, 'old'), paid('2026-07-02', 70_000, 'gone')]);
    expect(result.gameClub.rows.map((row) => row.preset.id)).toEqual(['old', 'a', 'b']);
    expect(result.gameClub.rows[0].cells[5].paid).toBe(50_000);
  });

  it('keeps the sides apart', () => {
    const presets = [preset({}), preset({ id: 'bar1', name: 'Bar rent', payment_source: 'bar' })];
    const result = history(presets, [paid('2026-10-01', 1_000_000), paid('2026-10-02', 500_000, 'bar1')]);
    expect(result.gameClub.rows.map((row) => row.preset.id)).toEqual(['p1']);
    expect(result.bar.rows.map((row) => row.preset.id)).toEqual(['bar1']);
    expect(result.gameClub.rows[0].cells[4].paid).toBe(1_000_000);
    expect(result.bar.rows[0].cells[4].paid).toBe(500_000);
  });

  it('has no rows for a side without plans', () => {
    const result = history([], []);
    expect(result.gameClub.rows).toEqual([]);
    expect(result.bar.rows).toEqual([]);
    expect(result.months).toHaveLength(PLAN_HISTORY_MONTHS);
  });
});
