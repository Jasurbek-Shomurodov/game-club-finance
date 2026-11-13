import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAnalysisLedgers } from './analysisLedgers';

type Result = { data: unknown; error: unknown };
type Call = [string, unknown[]];

const missingRpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_finance_report_snapshot' } };
const range = { from: '2026-10-01', to: '2026-10-31' };

/** Every `from(table)` starts a fresh chainable read that records its filters and resolves to `tables[table]`. */
function fakeClient(rpcResult: Result, tables: Record<string, Result> = {}) {
  const reads: Array<{ table: string; calls: Call[] }> = [];
  const from = vi.fn((table: string) => {
    const calls: Call[] = [];
    reads.push({ table, calls });
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'range']) {
      chain[method] = (...args: unknown[]) => { calls.push([method, args]); return chain; };
    }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(tables[table] ?? { data: [], error: null }).then(resolve);
    return chain;
  });
  const rpc = vi.fn(async () => rpcResult);
  return { supabase: { from, rpc } as unknown as SupabaseClient, from, rpc, reads };
}

describe('fetchAnalysisLedgers', () => {
  it('asks the snapshot RPC for the club, range and only the sections the analysis uses', async () => {
    const { supabase, rpc, from } = fakeClient({ data: {}, error: null });

    await expect(fetchAnalysisLedgers(supabase, 'club-1', range)).resolves.toEqual({
      cashRows: [], stockRows: [], purchaseRows: [], expenseRows: [], debtRows: [], debtPaymentRows: [],
    });

    expect(rpc).toHaveBeenCalledWith('get_finance_report_snapshot', {
      p_club_id: 'club-1',
      p_range_from: '2026-10-01',
      p_range_to: '2026-10-31',
      p_sections: ['cash', 'stock_totals', 'expenses', 'debts', 'debt_payments'],
    });
    // One round trip: no table is read when the RPC answers.
    expect(from).not.toHaveBeenCalled();
  });

  it('maps snapshot rows: bar profit is sales minus cost, debts count by issue date', async () => {
    const cashRows = [{ date: '2026-10-02', cash_income: 500_000, terminal_income: 200_000, card_income: 0, playstation_income: 50_000 }];
    const debtPaymentRows = [{ id: 'p1', date: '2026-10-04', amount: 30_000, payment_method: 'cash' }];
    const { supabase } = fakeClient({
      data: {
        cashRows,
        stockTotalRows: [
          { date: '2026-10-02', bar_income: '120000', bar_cost: '70000' },
          { date: '2026-10-03', bar_income: null, bar_cost: null },
        ],
        expenseRows: [
          { id: 'e1', date: '2026-10-02', amount: 40_000, category: 'rent', payment_source: 'bar' },
          { id: 'e2', date: '2026-10-03', amount: 10_000, category: 'other' },
        ],
        debtRows: [{ id: 'd1', date: '2026-10-03', amount: 90_000 }],
        debtPaymentRows,
      },
      error: null,
    });

    const ledgers = await fetchAnalysisLedgers(supabase, 'club-1', range);

    expect(ledgers.cashRows).toBe(cashRows);
    expect(ledgers.stockRows).toEqual([
      // 120 000 sold - 70 000 cost of goods = 50 000 accounting profit.
      { date: '2026-10-02', bar_income: 120_000, bar_cost: 70_000, bar_profit: 50_000, sold_quantity: 0 },
      { date: '2026-10-03', bar_income: 0, bar_cost: 0, bar_profit: 0, sold_quantity: 0 },
    ]);
    // Purchases are cash outflow, not part of accounting profit: the analysis reads none.
    expect(ledgers.purchaseRows).toEqual([]);
    expect(ledgers.expenseRows).toEqual([
      { id: 'e1', date: '2026-10-02', amount: 40_000, category: 'rent', payment_source: 'bar' },
      { id: 'e2', date: '2026-10-03', amount: 10_000, category: 'other', payment_source: null },
    ]);
    expect(ledgers.debtRows).toEqual([{ id: 'd1', date: '2026-10-03', amount: 90_000, remaining_amount: 0, status: 'unknown' }]);
    expect(ledgers.debtPaymentRows).toBe(debtPaymentRows);
  });

  it('throws a snapshot error without reading the tables', async () => {
    const error = { code: '42501', message: 'Not authorized' };
    const { supabase, from } = fakeClient({ data: null, error });
    await expect(fetchAnalysisLedgers(supabase, 'club-1', range)).rejects.toBe(error);
    expect(from).not.toHaveBeenCalled();
  });

  it('reads the five ledgers for the club and range while migration 049 is missing', async () => {
    const cash = [{ date: '2026-10-02', cash_income: 1, terminal_income: 2, card_income: 3, playstation_income: 4 }];
    const stock = [{ date: '2026-10-02', bar_income: 10, bar_cost: 6, bar_profit: 4, sold_quantity: 2, product_id: 'p1' }];
    const expenses = [{ id: 'e1', date: '2026-10-02', amount: 5, category: 'rent', payment_method: 'cash', payment_source: 'game_club' }];
    const debts = [{ id: 'd1', date: '2026-10-03', amount: 7, remaining_amount: 7, status: 'open' }];
    const payments = [{ id: 'p1', date: '2026-10-04', amount: 3, payment_method: 'card' }];
    const { supabase, reads } = fakeClient(missingRpc, {
      daily_cash_entries: { data: cash, error: null },
      daily_stock_counts: { data: stock, error: null },
      expenses: { data: expenses, error: null },
      new_debts: { data: debts, error: null },
      debt_payments: { data: payments, error: null },
    });

    await expect(fetchAnalysisLedgers(supabase, 'club-1', range)).resolves.toEqual({
      cashRows: cash, stockRows: stock, purchaseRows: [], expenseRows: expenses, debtRows: debts, debtPaymentRows: payments,
    });

    // Current ledgers only; the retired transaction tables are never read.
    expect(reads.map((read) => read.table).sort()).toEqual(['daily_cash_entries', 'daily_stock_counts', 'debt_payments', 'expenses', 'new_debts']);
    for (const read of reads) {
      expect(read.calls).toEqual(expect.arrayContaining([
        ['eq', ['club_id', 'club-1']],
        ['gte', ['date', '2026-10-01']],
        ['lte', ['date', '2026-10-31']],
      ]));
    }
  });

  it('returns empty ledgers when the fallback tables have no rows', async () => {
    const none = { data: null, error: null };
    const { supabase } = fakeClient(missingRpc, {
      daily_cash_entries: none, daily_stock_counts: none, expenses: none, new_debts: none, debt_payments: none,
    });
    await expect(fetchAnalysisLedgers(supabase, 'club-1', range)).resolves.toEqual({
      cashRows: [], stockRows: [], purchaseRows: [], expenseRows: [], debtRows: [], debtPaymentRows: [],
    });
  });

  it.each([
    ['daily_cash_entries'], ['daily_stock_counts'], ['expenses'], ['new_debts'], ['debt_payments'],
  ])('throws a failed %s read on the fallback path', async (table) => {
    const error = { message: `denied ${table}` };
    const { supabase } = fakeClient(missingRpc, { [table]: { data: null, error } });
    await expect(fetchAnalysisLedgers(supabase, 'club-1', range)).rejects.toBe(error);
  });
});
