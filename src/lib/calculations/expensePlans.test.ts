import { describe, expect, it } from 'vitest';
import { buildExpensePlanSummary, plannedAmountForRange, type ExpensePreset } from './expensePlans';

const preset = (overrides: Partial<ExpensePreset>): ExpensePreset => ({
  id: 'p1',
  name: 'Electricity',
  category: 'electricity',
  payment_source: 'game_club',
  monthly_amount: 3_000_000,
  sort_order: 0,
  archived_at: null,
  ...overrides,
});

describe('plannedAmountForRange', () => {
  it('is the monthly amount for a whole month and multiplies over months', () => {
    expect(plannedAmountForRange(3_000_000, { from: '2026-10-01', to: '2026-10-31' })).toBe(3_000_000);
    expect(plannedAmountForRange(3_000_000, { from: '2026-09-01', to: '2026-10-31' })).toBe(6_000_000);
    expect(plannedAmountForRange(1_200_000, { from: '2025-12-01', to: '2026-02-28' })).toBe(3_600_000);
  });

  it('prorates partial months by their own length', () => {
    // 15 of 30 September days + 10 of 31 October days.
    expect(plannedAmountForRange(3_000_000, { from: '2026-09-16', to: '2026-10-10' }))
      .toBe(Math.round(1_500_000 + 3_000_000 * (10 / 31)));
    expect(plannedAmountForRange(2_800_000, { from: '2026-02-01', to: '2026-02-14' })).toBe(1_400_000);
  });

  it('is zero without a plan or for an inverted range', () => {
    expect(plannedAmountForRange(0, { from: '2026-10-01', to: '2026-10-31' })).toBe(0);
    expect(plannedAmountForRange(100, { from: '2026-10-05', to: '2026-10-01' })).toBe(0);
  });
});

describe('buildExpensePlanSummary', () => {
  const range = { from: '2026-10-01', to: '2026-10-31' };

  it('compares each preset with its linked expenses and keeps the two sides apart', () => {
    const summary = buildExpensePlanSummary(
      [
        preset({ id: 'icafe', name: 'iCafe', category: 'equipment', monthly_amount: 500_000, sort_order: 2 }),
        preset({ id: 'power', sort_order: 1 }),
        preset({ id: 'bar-fridge', name: 'Fridge service', category: 'repair', payment_source: 'bar', monthly_amount: 200_000 }),
      ],
      [
        { date: '2026-10-03', amount: 2_000_000, preset_id: 'power' },
        { date: '2026-10-20', amount: 1_500_000, preset_id: 'power' },
        { date: '2026-10-05', amount: 400_000, preset_id: 'icafe' },
        { date: '2026-09-30', amount: 999_999, preset_id: 'power' },
        { date: '2026-10-07', amount: 50_000, preset_id: null },
      ],
      range,
    );

    expect(summary.gameClub.rows.map((row) => [row.preset.id, row.planned, row.actual, row.difference, row.usedPct, row.count]))
      .toEqual([
        ['power', 3_000_000, 3_500_000, 500_000, 116.7, 2],
        ['icafe', 500_000, 400_000, -100_000, 80, 1],
      ]);
    expect(summary.gameClub).toMatchObject({ planned: 3_500_000, actual: 3_900_000, difference: 400_000 });
    expect(summary.bar).toMatchObject({ planned: 200_000, actual: 0, difference: -200_000 });
    expect(summary.bar.rows[0].usedPct).toBe(0);
  });

  it('shows archived presets only while they still have spending, without a plan', () => {
    const archived = preset({ id: 'old', name: 'Server', archived_at: '2026-10-10T00:00:00Z' });
    expect(buildExpensePlanSummary([archived], [], range).gameClub.rows).toEqual([]);
    const summary = buildExpensePlanSummary([archived], [{ date: '2026-10-02', amount: 700_000, preset_id: 'old' }], range);
    expect(summary.gameClub.rows[0]).toMatchObject({ planned: 0, actual: 700_000, difference: 700_000, usedPct: null });
  });
});
