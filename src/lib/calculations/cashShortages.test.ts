import { describe, expect, it } from 'vitest';
import { cashShortageTotalsForMonth, recoverableAmount, summarizeCashShortages } from './cashShortages';
import type { CashShortage } from '@/types';

const shortage = (id: string, overrides: Partial<CashShortage> = {}): CashShortage => ({
  id,
  club_id: 'club',
  date: '2026-11-05',
  payment_source: 'game_club',
  payment_method: 'cash',
  amount: 500_000,
  reason: 'stolen',
  employee_id: 'employee',
  comment: 'Cash was missing at the evening handover',
  created_by: 'owner',
  created_at: '2026-11-05T18:00:00Z',
  ...overrides,
});

describe('summarizeCashShortages', () => {
  it('subtracts live recovery fines from each shortage', () => {
    const [summary] = summarizeCashShortages([shortage('a')], [
      { id: 'f1', cash_shortage_id: 'a', amount: 200_000, date: '2026-11-05' },
      { id: 'f2', cash_shortage_id: 'a', amount: 100_000, date: '2026-11-10' },
      { id: 'f3', cash_shortage_id: 'other', amount: 50_000, date: '2026-11-10' },
    ]);
    expect(summary).toMatchObject({ recovered: 300_000, lost: 200_000 });
  });

  it('never reports more recovered than the shortage, or a negative loss', () => {
    const [summary] = summarizeCashShortages([shortage('a', { amount: 100_000 })], [
      { id: 'f1', cash_shortage_id: 'a', amount: 150_000, date: '2026-11-05' },
    ]);
    expect(summary).toMatchObject({ recovered: 100_000, lost: 0 });
  });

  it('lists the newest shortage first', () => {
    const ids = summarizeCashShortages([
      shortage('old', { date: '2026-11-01' }),
      shortage('new', { date: '2026-11-09' }),
      shortage('same-day-later', { date: '2026-11-09', created_at: '2026-11-09T20:00:00Z' }),
    ], []).map((row) => row.shortage.id);
    expect(ids).toEqual(['same-day-later', 'new', 'old']);
  });
});

describe('cashShortageTotalsForMonth', () => {
  it('keeps Game Club and Bar apart and only counts the month', () => {
    const summaries = summarizeCashShortages([
      shortage('club', { amount: 400_000 }),
      shortage('bar', { payment_source: 'bar', amount: 60_000, employee_id: null }),
      shortage('october', { date: '2026-10-30', amount: 900_000 }),
    ], [{ id: 'f', cash_shortage_id: 'club', amount: 150_000, date: '2026-11-06' }]);
    expect(cashShortageTotalsForMonth(summaries, '2026-11')).toEqual({
      game_club: { amount: 400_000, recovered: 150_000, lost: 250_000 },
      bar: { amount: 60_000, recovered: 0, lost: 60_000 },
    });
  });
});

describe('recoverableAmount', () => {
  it('is what is still lost when someone is responsible, else nothing', () => {
    const [withEmployee, unknown] = summarizeCashShortages([
      shortage('a', { date: '2026-11-06' }),
      shortage('b', { employee_id: null }),
    ], [{ id: 'f', cash_shortage_id: 'a', amount: 100_000, date: '2026-11-06' }]);
    expect(recoverableAmount(withEmployee)).toBe(400_000);
    expect(recoverableAmount(unknown)).toBe(0);
  });
});
