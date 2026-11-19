import { describe, expect, it } from 'vitest';
import {
  dollarReserveEntries,
  groupReserveActivityByDay,
  reserveActivity,
  reserveBalances,
  reserveBuyLimits,
  reserveDailySeries,
  reserveDollarRates,
  reserveFlowTotals,
  reserveMonthlySeries,
} from './ownerReserve';
import type { MoneyExchangeRow } from './moneyExchanges';
import type { OwnerReserveEntry } from '@/types';

/** Exchanges inside the reserve (170): a return or deposit paired with a dollar exchange. */

const entry = (id: string, overrides: Partial<OwnerReserveEntry>): OwnerReserveEntry => ({
  id, club_id: 'club', kind: 'deposit', period_month: '2026-11-01', source: 'game_club', payment_method: 'cash',
  amount: 10_000_000, comment: 'Saved for the PS5', collection_date: null, entry_date: '2026-11-02',
  created_by: 'owner', created_at: '2026-11-02T10:00:00Z', ...overrides,
});
const exchange = (id: string, overrides: Partial<MoneyExchangeRow>): MoneyExchangeRow => ({
  id, date: '2026-11-10', from_method: 'cash', to_method: 'usd', from_amount: 2_500_000, to_amount: 200, rate: 12_500,
  comment: 'Dollars for the savings', created_at: '2026-11-10T09:00:00Z', ...overrides,
});

const exchanges = [
  exchange('buy', {}),
  // Sold $50 back into cash inside the reserve.
  exchange('sell', { date: '2026-11-15', from_method: 'usd', to_method: 'cash', from_amount: 50, to_amount: 650_000, rate: 13_000, created_at: '2026-11-15T09:00:00Z' }),
  // An exchange made in Reports, from the till: an ordinary dollar deposit.
  exchange('till', { date: '2026-11-12', from_amount: 1_250_000, to_amount: 100, created_at: '2026-11-12T09:00:00Z' }),
];
const ledger = [
  entry('saved', {}),
  entry('buy-half', { kind: 'return', amount: 2_500_000, entry_date: '2026-11-10', paired_exchange_id: 'buy', created_at: '2026-11-10T09:00:00Z' }),
  entry('sell-half', { kind: 'deposit', amount: 650_000, entry_date: '2026-11-15', paired_exchange_id: 'sell', created_at: '2026-11-15T09:00:00Z' }),
  ...dollarReserveEntries(exchanges, 'club'),
];

describe('reserve exchanges', () => {
  it('shows each exchange inside the reserve as one row with its dollars, rate and method', () => {
    const activity = reserveActivity(ledger, []);
    expect(activity.map((row) => `${row.kind}:${row.id}`)).toEqual([
      'exchange:sell', 'deposit:exchange:till', 'exchange:buy', 'deposit:saved',
    ]);
    expect(activity[0]).toMatchObject({ kind: 'exchange', direction: 'sell', usd: 50, amount: 650_000, rate: 13_000, method: 'cash', date: '2026-11-15' });
    expect(activity[2]).toMatchObject({ kind: 'exchange', direction: 'buy', usd: 200, amount: 2_500_000, method: 'cash' });
  });

  it('keeps what the reserve holds while counting nothing in or out for an exchange inside it', () => {
    const balances = reserveBalances(ledger, []);
    // 10 000 000 saved + 1 250 000 of dollars from the till.
    expect(balances.game_club.held).toBe(11_250_000);
    expect(balances.game_club.byMethod.usd).toBe(2_500_000 + 1_250_000 - 650_000);
    expect(balances.game_club.byMethod.cash).toBe(10_000_000 - 2_500_000 + 650_000);

    const activity = reserveActivity(ledger, []);
    expect(reserveFlowTotals(activity)).toEqual({ deposited: 11_250_000, returned: 0, spent: 0, exchanged: 2 });
    const days = groupReserveActivityByDay(activity);
    expect(days.find((day) => day.date === '2026-11-10')).toMatchObject({ deposited: 0, withdrawn: 0 });
    const daily = reserveDailySeries(ledger, [], '2026-11-16');
    expect(daily.at(-1)?.held).toBe(11_250_000);
    expect(daily.find((day) => day.date === '2026-11-10')?.held).toBe(10_000_000);
    expect(reserveMonthlySeries(ledger, [], '2026-11')).toEqual([
      { month: '2026-11', deposited: 11_250_000, withdrawn: 0, gameClubHeld: 11_250_000, barHeld: 0 },
    ]);
  });

  it('limits a buy to what a method saved, never above the reserve\'s sums', () => {
    const limits = reserveBuyLimits(ledger, 4_000_000);
    expect(limits).toEqual({ cash: 4_000_000, terminal: 0, card: 0, playstation: 0 });
    expect(reserveBuyLimits(ledger, 50_000_000).cash).toBe(8_150_000);
    expect(reserveBuyLimits(ledger, -1).cash).toBe(0);
  });

  it('reports the latest rate and what the held dollars cost on average', () => {
    expect(reserveDollarRates(exchanges, 250, 3_100_000)).toEqual({ lastRate: 13_000, lastDate: '2026-11-15', averageRate: 12_400 });
    expect(reserveDollarRates([], 0, 0)).toEqual({ lastRate: null, lastDate: null, averageRate: null });
  });
});
