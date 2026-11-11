import { describe, expect, it } from 'vitest';
import { applyOwnerReserve, reserveActivity, reserveBalances, reserveForMonth, planGameClubDepositAll, type ReservePaidExpense } from './ownerReserve';
import { sumAvailableMoneyResults, type AvailableMoneyByMonth } from './availableMoney';
import type { OwnerReserveEntry } from '@/types';

const entry = (id: string, overrides: Partial<OwnerReserveEntry>): OwnerReserveEntry => ({
  id, club_id: 'club', kind: 'deposit', period_month: '2026-09-01', source: 'game_club', payment_method: 'cash',
  amount: 1_000_000, comment: 'For new PCs', created_by: 'owner', created_at: '2026-09-30T10:00:00Z', ...overrides,
});
const purchase = (id: string, overrides: Partial<ReservePaidExpense> = {}): ReservePaidExpense => ({
  id, date: '2026-11-05', amount: 2_500_000, payment_source: 'game_club', payment_method: 'cash',
  category: 'equipment', comment: 'Two new PCs', created_at: '2026-11-05T12:00:00Z', ...overrides,
});
const month = (gameClubEarned: number, barEarned = 0): AvailableMoneyByMonth[string] => {
  const base = sumAvailableMoneyResults([]);
  return {
    ...base,
    gameClub: { earned: gameClubEarned, withdrawn: 0, available: gameClubEarned, overdrawnBy: 0 },
    bar: { earned: barEarned, withdrawn: 0, available: barEarned, overdrawnBy: 0 },
  };
};

const entries = [
  entry('sep', {}),
  entry('oct', { period_month: '2026-10-01', amount: 2_000_000, created_at: '2026-10-31T10:00:00Z' }),
  entry('bar', { source: 'bar', payment_method: null, amount: 300_000 }),
  entry('back', { kind: 'return', period_month: '2026-10-01', amount: 200_000, created_at: '2026-10-31T11:00:00Z' }),
];
const purchases = [purchase('pcs')];

describe('applyOwnerReserve', () => {
  it('takes deposits out of their month, returns into it, and lifts a reserve purchase off its month', () => {
    const result = applyOwnerReserve({
      '2026-09': month(3_000_000, 500_000),
      '2026-10': month(3_000_000),
      // November earned already counts the 2 500 000 purchase as an expense.
      '2026-11': month(500_000),
    }, entries, purchases, '2026-11');
    expect(result['2026-09'].gameClub).toMatchObject({ earned: 3_000_000, available: 2_000_000 });
    expect(result['2026-09'].bar).toMatchObject({ earned: 500_000, available: 200_000 });
    expect(result['2026-10'].gameClub).toMatchObject({ available: 1_200_000 });
    expect(result['2026-11'].gameClub).toMatchObject({ earned: 3_000_000, available: 3_000_000 });
  });

  it('leaves out months after the current one', () => {
    const result = applyOwnerReserve({}, [entry('future', { period_month: '2026-12-01' })], [], '2026-11');
    expect(result['2026-12']).toBeUndefined();
  });
});

describe('reserveBalances', () => {
  it('holds deposits minus returns minus purchases, per side and per Game Club method', () => {
    const balances = reserveBalances(entries, [...purchases, purchase('bar-fridge', { payment_source: 'bar', payment_method: 'terminal', amount: 100_000 })]);
    expect(balances.game_club).toMatchObject({ deposited: 3_000_000, returned: 200_000, spent: 2_500_000, held: 300_000 });
    expect(balances.game_club.byMethod.cash).toBe(300_000);
    expect(balances.bar).toMatchObject({ held: 200_000, spent: 100_000 });
  });
});

describe('reserveForMonth', () => {
  it('buckets an unknown Game Club method into card, like the database', () => {
    const flow = reserveForMonth([], [purchase('qr', { payment_method: 'qr', amount: 10 })], '2026-11');
    expect(flow.byMethod.card.spent).toBe(10);
    expect(flow.bySource.game_club.spent).toBe(10);
  });
});

describe('reserveActivity', () => {
  it('lists the newest first', () => {
    expect(reserveActivity(entries, purchases).map((row) => row.id)).toEqual(['pcs', 'back', 'oct', 'sep', 'bar']);
  });
});

describe('planGameClubDepositAll', () => {
  it('takes every method that holds money, skips negative ones, and never exceeds Game Club', () => {
    const methods = [
      { method: 'cash' as const, available: 7_928_483 },
      { method: 'terminal' as const, available: -800 },
      { method: 'card' as const, available: 4_172_000 },
      { method: 'playstation' as const, available: 0 },
    ];
    expect(planGameClubDepositAll(methods, 12_099_683)).toEqual([
      { method: 'cash', amount: 7_928_483 },
      { method: 'card', amount: 4_171_200 },
    ]);
    expect(planGameClubDepositAll(methods, -5)).toEqual([]);
  });
});
