import { describe, expect, it } from 'vitest';
import { applyOwnerReserve, dollarReserveEntries, reserveActivity, groupReserveActivityByDay, reserveMonthlySeries, reserveDailySeries, reserveBalances, reserveForMonth, planGameClubDepositAll, type ReservePaidExpense } from './ownerReserve';
import { sumAvailableMoneyResults, type AvailableMoneyByMonth } from './availableMoney';
import type { OwnerReserveEntry } from '@/types';

const entry = (id: string, overrides: Partial<OwnerReserveEntry>): OwnerReserveEntry => ({
  id, club_id: 'club', kind: 'deposit', period_month: '2026-09-01', source: 'game_club', payment_method: 'cash',
  amount: 1_000_000, comment: 'For new PCs', collection_date: null, created_by: 'owner', created_at: '2026-09-30T10:00:00Z', ...overrides,
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

describe('groupReserveActivityByDay', () => {
  it('buckets newest-first activity by day with each day\'s in and out', () => {
    const days = groupReserveActivityByDay(reserveActivity(entries, purchases));
    expect(days.map((day) => [day.date, day.rows.map((row) => row.id), day.deposited, day.withdrawn])).toEqual([
      ['2026-11-05', ['pcs'], 0, 2_500_000],
      ['2026-10-31', ['back', 'oct'], 2_000_000, 200_000],
      ['2026-09-30', ['sep', 'bar'], 1_300_000, 0],
    ]);
  });
});

describe('dollarReserveEntries', () => {
  const row = (id: string, from: 'cash' | 'usd', to: 'cash' | 'usd' | 'card', fromAmount: number, toAmount: number) => ({
    id, date: '2026-10-31', from_method: from, to_method: to, from_amount: fromAmount, to_amount: toAmount, rate: 12_000,
  });

  it('turns exchanges into and out of dollars into reserve deposits and returns of the sums', () => {
    const entries = dollarReserveEntries([
      row('a', 'cash', 'usd', 1_200_000, 100),
      row('b', 'usd', 'cash', 10, 125_000),
      row('c', 'cash', 'card', 5_000, 5_000),
    ], 'club');
    expect(entries.map(({ kind, amount, payment_method, period_month, exchange_id }) => ({ kind, amount, payment_method, period_month, exchange_id })))
      .toEqual([
        { kind: 'deposit', amount: 1_200_000, payment_method: 'usd', period_month: '2026-10-01', exchange_id: 'a' },
        { kind: 'return', amount: 125_000, payment_method: 'usd', period_month: '2026-10-01', exchange_id: 'b' },
      ]);
  });

  it('lets the reserve pay dollar expenses, so the month keeps only what its methods hold', () => {
    const entries = dollarReserveEntries([row('a', 'cash', 'usd', 21_243_000, 1_796.92)], 'club');
    const rent: ReservePaidExpense = {
      id: 'rent', date: '2026-10-31', amount: 15_000_000, payment_source: 'game_club', payment_method: 'usd',
      category: 'rent', comment: null, created_at: '2026-10-31T10:00:00Z',
    };
    const month = reserveForMonth(entries, [rent], '2026-10');
    expect(month.byMethod.usd).toEqual({ deposited: 21_243_000, returned: 0, spent: 15_000_000 });
    expect(reserveBalances(entries, [rent]).game_club.byMethod.usd).toBe(6_243_000);
  });
});

describe('reserveMonthlySeries', () => {
  const entry = (month: string, kind: 'deposit' | 'return', amount: number, source: 'game_club' | 'bar' = 'game_club'): OwnerReserveEntry => ({
    id: `${month}-${kind}-${amount}`, club_id: 'club', kind, period_month: `${month}-01`, source,
    payment_method: source === 'bar' ? null : 'cash', amount, comment: null, collection_date: null, created_by: 'owner', created_at: `${month}-02T00:00:00Z`,
  });

  it('fills every month through today and keeps a running balance per side', () => {
    const purchase: ReservePaidExpense = {
      id: 'p', date: '2026-10-05', amount: 200, payment_source: 'game_club', payment_method: 'cash',
      category: 'repair', comment: null, created_at: '2026-10-05T00:00:00Z',
    };
    const rows = reserveMonthlySeries(
      [entry('2026-08', 'deposit', 1_000), entry('2026-10', 'return', 100), entry('2026-10', 'deposit', 50, 'bar'), entry('2027-01', 'deposit', 5)],
      [purchase],
      '2026-11',
    );
    expect(rows).toEqual([
      { month: '2026-08', deposited: 1_000, withdrawn: 0, gameClubHeld: 1_000, barHeld: 0 },
      { month: '2026-09', deposited: 0, withdrawn: 0, gameClubHeld: 1_000, barHeld: 0 },
      { month: '2026-10', deposited: 50, withdrawn: 300, gameClubHeld: 700, barHeld: 50 },
      { month: '2026-11', deposited: 0, withdrawn: 0, gameClubHeld: 700, barHeld: 50 },
    ]);
  });

  it('is empty without reserve activity', () => {
    expect(reserveMonthlySeries([], [], '2026-11')).toEqual([]);
  });
});

describe('reserveDailySeries', () => {
  const entry = (day: string, kind: 'deposit' | 'return', amount: number, source: 'game_club' | 'bar' = 'game_club'): OwnerReserveEntry => ({
    id: `${day}-${kind}-${amount}`, club_id: 'club', kind, period_month: `${day.slice(0, 7)}-01`, source,
    payment_method: source === 'bar' ? null : 'cash', amount, comment: null, collection_date: null, created_by: 'owner', created_at: `${day}T10:00:00Z`,
  });

  it('fills every day through today with each side\'s running balance', () => {
    const purchase: ReservePaidExpense = {
      id: 'p', date: '2026-10-31', amount: 200, payment_source: 'game_club', payment_method: 'cash',
      category: 'repair', comment: null, created_at: '2026-10-31T09:00:00Z',
    };
    const rows = reserveDailySeries(
      [entry('2026-10-30', 'deposit', 1_000), entry('2026-11-01', 'return', 100), entry('2026-11-01', 'deposit', 50, 'bar')],
      [purchase],
      '2026-11-02',
    );
    expect(rows).toEqual([
      { date: '2026-10-30', gameClubHeld: 1_000, barHeld: 0 },
      { date: '2026-10-31', gameClubHeld: 800, barHeld: 0 },
      { date: '2026-11-01', gameClubHeld: 700, barHeld: 50 },
      { date: '2026-11-02', gameClubHeld: 700, barHeld: 50 },
    ]);
  });

  it('counts activity dated after today on today, and is empty without activity', () => {
    expect(reserveDailySeries([entry('2026-11-05', 'deposit', 10)], [], '2026-11-03')).toEqual([
      { date: '2026-11-03', gameClubHeld: 10, barHeld: 0 },
    ]);
    expect(reserveDailySeries([], [], '2026-11-03')).toEqual([]);
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
