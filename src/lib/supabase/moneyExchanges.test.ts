import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchDollarExpenses, fetchMoneyExchanges, withDollarAmounts, type DollarExpense } from './moneyExchanges';

type Result = { data: unknown; error: unknown };
type Call = [string, unknown[]];

/** A chainable read that records its table and filters and resolves to `result`. */
function fakeClient(result: Result) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'range']) {
    chain[method] = (...args: unknown[]) => { calls.push([method, args]); return chain; };
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  const from = vi.fn(() => chain);
  return { supabase: { from } as unknown as SupabaseClient, from, calls };
}

describe('fetchMoneyExchanges', () => {
  it('reads the club exchanges inside the range, oldest first', async () => {
    const row = { id: 'x1', date: '2026-10-05', from_method: 'cash', to_method: 'usd', from_amount: 1_280_000, to_amount: 100, rate: 12_800 };
    const { supabase, from, calls } = fakeClient({ data: [row], error: null });

    await expect(fetchMoneyExchanges(supabase, 'club-1', '2026-10-01', '2026-10-31')).resolves.toEqual([row]);

    expect(from).toHaveBeenCalledWith('money_exchanges');
    expect(calls).toEqual(expect.arrayContaining([
      ['eq', ['club_id', 'club-1']],
      ['gte', ['date', '2026-10-01']],
      ['lte', ['date', '2026-10-31']],
      ['order', ['date', { ascending: true }]],
      ['order', ['id', { ascending: true }]],
    ]));
  });

  it('has no exchanges before migration 092 or for an empty ledger', async () => {
    const missing = fakeClient({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.money_exchanges'" } });
    await expect(fetchMoneyExchanges(missing.supabase, 'club-1', '2026-10-01', '2026-10-31')).resolves.toEqual([]);
    await expect(fetchMoneyExchanges(fakeClient({ data: null, error: null }).supabase, 'club-1', '2026-10-01', '2026-10-31')).resolves.toEqual([]);
  });

  it('throws any other error', async () => {
    const error = { code: '42501', message: 'denied' };
    await expect(fetchMoneyExchanges(fakeClient({ data: null, error }).supabase, 'club-1', '2026-10-01', '2026-10-31')).rejects.toBe(error);
  });
});

describe('fetchDollarExpenses', () => {
  it('reads only the club expenses paid from dollars inside the range', async () => {
    const row = { id: 'e1', date: '2026-10-07', amount: 640_000, payment_method: 'usd', usd_amount: 50, usd_rate: 12_800 };
    const { supabase, from, calls } = fakeClient({ data: [row], error: null });

    await expect(fetchDollarExpenses(supabase, 'club-1', '2026-10-01', '2026-10-31')).resolves.toEqual([row]);

    expect(from).toHaveBeenCalledWith('expenses');
    expect(calls).toEqual(expect.arrayContaining([
      ['eq', ['club_id', 'club-1']],
      ['eq', ['payment_method', 'usd']],
      ['gte', ['date', '2026-10-01']],
      ['lte', ['date', '2026-10-31']],
    ]));
  });

  it('has no dollar spending before migration 124 or for an empty ledger', async () => {
    const missing = fakeClient({ data: null, error: { code: '42703', message: 'column expenses.usd_amount does not exist' } });
    await expect(fetchDollarExpenses(missing.supabase, 'club-1', '2026-10-01', '2026-10-31')).resolves.toEqual([]);
    await expect(fetchDollarExpenses(fakeClient({ data: null, error: null }).supabase, 'club-1', '2026-10-01', '2026-10-31')).resolves.toEqual([]);
  });

  it('throws other errors, including a different missing column', async () => {
    const denied = { code: '42501', message: 'denied' };
    await expect(fetchDollarExpenses(fakeClient({ data: null, error: denied }).supabase, 'club-1', '2026-10-01', '2026-10-31')).rejects.toBe(denied);
    const otherColumn = { code: '42703', message: 'column expenses.payment_method does not exist' };
    await expect(fetchDollarExpenses(fakeClient({ data: null, error: otherColumn }).supabase, 'club-1', '2026-10-01', '2026-10-31')).rejects.toBe(otherColumn);
  });
});

describe('withDollarAmounts', () => {
  const dollar: DollarExpense = { id: 'e2', date: '2026-10-07', amount: 640_000, payment_method: 'usd', usd_amount: 50, usd_rate: 12_800 };

  it('returns the same rows when nothing was paid from dollars', () => {
    const expenses = [{ id: 'e1', amount: 10_000, payment_method: 'cash' }];
    expect(withDollarAmounts(expenses, [])).toBe(expenses);
  });

  it('adds dollars and rate to the matching expense only, keeping its sums value', () => {
    const cash = { id: 'e1', amount: 10_000, payment_method: 'cash' };
    // The 047 snapshot predates 124, so the row arrives without the dollar columns.
    const paidInDollars = { id: 'e2', amount: 640_000, payment_method: 'card' };

    const result = withDollarAmounts([cash, paidInDollars], [dollar]);

    expect(result).toEqual([
      { id: 'e1', amount: 10_000, payment_method: 'cash' },
      { id: 'e2', amount: 640_000, payment_method: 'usd', usd_amount: 50, usd_rate: 12_800 },
    ]);
    // Untouched rows keep their identity and the input is not mutated.
    expect(result[0]).toBe(cash);
    expect(paidInDollars).toEqual({ id: 'e2', amount: 640_000, payment_method: 'card' });
  });

  it('ignores dollar expenses that are not among the rows', () => {
    const expenses = [{ id: 'e1', amount: 10_000 }];
    expect(withDollarAmounts(expenses, [dollar])).toEqual([{ id: 'e1', amount: 10_000 }]);
  });
});
