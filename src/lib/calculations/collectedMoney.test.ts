import { describe, expect, it } from 'vitest';
import { addCollectedByMethod, moneyStillHeld, NO_MONEY_COLLECTED, summarizeCollectedMoney } from './collectedMoney';
import type { MoneyReportDay } from './moneyReport';

function day(date: string, values: Partial<MoneyReportDay>): MoneyReportDay {
  return {
    date,
    cash: 0,
    terminal: 0,
    card: 0,
    playstation: 0,
    total: 0,
    income: 0,
    expenses: 0,
    gameClubExpenses: 0,
    barExpenses: 0,
    activities: [],
    ...values,
  };
}

describe('summarizeCollectedMoney', () => {
  const days = [
    day('2026-10-24', { cash: 1_000, terminal: 500, playstation: 100, total: 1_600 }),
    day('2026-10-23', { cash: 700, terminal: 300, total: 1_000 }),
    day('2026-10-22', { cash: 400, total: 400 }),
    day('2026-10-21', { total: 0 }),
  ];

  it('lists ticked dates newest first with their money by method and totals', () => {
    const summary = summarizeCollectedMoney(days, [
      { date: '2026-10-23', collected_at: '2026-10-24T08:00:00Z', collector_name: 'Izzat' },
      { date: '2026-10-24', collected_at: '2026-10-25T08:00:00Z', collector_name: null },
    ]);

    expect(summary.days.map((row) => row.date)).toEqual(['2026-10-24', '2026-10-23']);
    expect(summary.days[1]).toMatchObject({ collectorName: 'Izzat', cash: 700, terminal: 300, total: 1_000 });
    expect(summary.taken).toEqual({ cash: 1_700, terminal: 800, card: 0, playstation: 100, total: 2_600 });
  });

  it('counts unticked dates with money as still waiting to be collected', () => {
    const summary = summarizeCollectedMoney(days, [
      { date: '2026-10-24', collected_at: '2026-10-25T08:00:00Z', collector_name: 'Izzat' },
    ]);

    expect(summary.pendingDays).toBe(2);
    expect(summary.pendingTotal).toBe(1_400);
  });

  it('keeps a ticked date that has no entries, with zeros', () => {
    const summary = summarizeCollectedMoney([], [
      { date: '2026-10-20', collected_at: '2026-10-21T08:00:00Z', collector_name: 'Izzat' },
    ]);

    expect(summary.days).toEqual([{
      date: '2026-10-20',
      collectedAt: '2026-10-21T08:00:00Z',
      collectorName: 'Izzat',
      cash: 0,
      terminal: 0,
      card: 0,
      playstation: 0,
      total: 0,
    }]);
    expect(summary.pendingDays).toBe(0);
  });
});

describe('collected money per method', () => {
  it('adds the earlier span to the period and leaves the rest in the method', () => {
    const earlier = { cash: 1_000, terminal: 200, card: 0, playstation: 50, total: 1_250 };
    const period = { cash: 400, terminal: 0, card: 100, playstation: 0, total: 500 };
    const taken = addCollectedByMethod(NO_MONEY_COLLECTED, addCollectedByMethod(earlier, period));
    expect(taken).toEqual({ cash: 1_400, terminal: 200, card: 100, playstation: 50, total: 1_750 });
    expect(moneyStillHeld(4_847_000, 4_000_000)).toBe(847_000);
    expect(moneyStillHeld(500, 0)).toBe(500);
  });
});
