import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadFinanceReportRows, sortExpenseRows, sortStockCountRows } from './financeReportSnapshot';

type Result = { data: unknown; error: unknown };
type Call = [string, unknown[]];
interface Read { table: string; calls: Call[] }

const missingRpc = { data: null, error: { code: 'PGRST202', message: 'Function was not found' } };
const selected = (read: Read) => String(read.calls.find(([name]) => name === 'select')?.[1][0] ?? '');

/** Every `from(table)` starts a fresh chainable read; `answer` decides its page from the table and select. */
function fakeClient(answer: (read: Read) => Result | undefined, rpcResult: Result = missingRpc) {
  const reads: Read[] = [];
  const from = vi.fn((table: string) => {
    const read: Read = { table, calls: [] };
    reads.push(read);
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'range']) {
      chain[method] = (...args: unknown[]) => { read.calls.push([method, args]); return chain; };
    }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(answer(read) ?? { data: [], error: null }).then(resolve);
    return chain;
  });
  return { supabase: { from, rpc: vi.fn(async () => rpcResult) } as unknown as SupabaseClient, reads };
}

describe('sortStockCountRows', () => {
  it('puts products in their configured order, unordered ones last, then by name', () => {
    const rows = [
      { product_id: 'p4', product_name: 'Water', sort_order: null },
      { product_id: 'p3', product_name: 'Tea', sort_order: 2 },
      { product_id: 'p2', product_name: 'Fanta', sort_order: 2 },
      { product_id: 'p5', product_name: 'Chips', sort_order: null },
      { product_id: 'p1', product_name: 'Cola', sort_order: 1 },
    ];
    expect(sortStockCountRows(rows).map((row) => row.product_name)).toEqual(['Cola', 'Fanta', 'Tea', 'Chips', 'Water']);
    // The input keeps its order: callers hold the unsorted rows too.
    expect(rows[0].product_id).toBe('p4');
  });

  it('falls back to the product id when a name is missing', () => {
    const rows = [
      { product_id: 'b-id', product_name: null, sort_order: null },
      { product_id: 'z-id', product_name: 'Apple', sort_order: null },
      { product_id: 'a-id', product_name: null, sort_order: null },
    ];
    expect(sortStockCountRows(rows).map((row) => row.product_id)).toEqual(['a-id', 'z-id', 'b-id']);
  });
});

describe('sortExpenseRows', () => {
  it('orders by when the expense was recorded; ids only break ties', () => {
    const rows = [
      { id: 'c', created_at: '2026-10-02T09:00:00Z' },
      { id: 'b', created_at: '2026-10-01T09:00:00Z' },
      { id: 'a', created_at: '2026-10-02T09:00:00Z' },
    ];
    expect(sortExpenseRows(rows).map((row) => row.id)).toEqual(['b', 'a', 'c']);
  });

  it('puts rows without a creation time first, by id', () => {
    const rows = [
      { id: 'z', created_at: '2026-10-01T09:00:00Z' },
      { id: 'y', created_at: undefined as unknown as string },
      { id: 'x', created_at: undefined as unknown as string },
    ];
    expect(sortExpenseRows(rows).map((row) => row.id)).toEqual(['x', 'y', 'z']);
  });
});

describe('loadFinanceReportRows', () => {
  it('returns a snapshot error without reading any table', async () => {
    const error = { code: '42501', message: 'Not authorized' };
    const { supabase, reads } = fakeClient(() => undefined, { data: null, error });
    await expect(loadFinanceReportRows(supabase, 'club-1', '2026-09-01', '2026-09-30', 'range')).resolves.toEqual({ data: null, error });
    expect(reads).toEqual([]);
  });

  it('asks the snapshot for stock totals, not per-product counts, for a range', async () => {
    const { supabase } = fakeClient(() => undefined, { data: { stockTotalRows: [{ date: '2026-09-01', bar_income: 5, bar_cost: 3 }] }, error: null });
    const result = await loadFinanceReportRows(supabase, 'club-1', '2026-09-01', '2026-09-30', 'range');
    expect(supabase.rpc).toHaveBeenCalledWith('get_finance_report_snapshot', {
      p_club_id: 'club-1', p_range_from: '2026-09-01', p_range_to: '2026-09-30',
      p_sections: ['cash', 'stock_totals', 'purchases', 'expenses', 'debts'],
    });
    expect(result.data?.stockTotalRows).toEqual([{ date: '2026-09-01', bar_income: 5, bar_cost: 3 }]);
    expect(result.data?.stockCountRows).toEqual([]);
  });

  it('scopes every fallback read to the club and the date range', async () => {
    const { supabase, reads } = fakeClient(() => undefined);
    await loadFinanceReportRows(supabase, 'club-1', '2026-09-01', '2026-09-30', 'range');

    expect(reads.map((read) => read.table).sort()).toEqual(['daily_cash_entries', 'daily_stock_counts', 'expenses', 'new_debts', 'stock_purchases']);
    for (const read of reads) {
      expect(read.calls).toEqual(expect.arrayContaining([
        ['eq', ['club_id', 'club-1']],
        ['gte', ['date', '2026-09-01']],
        ['lte', ['date', '2026-09-30']],
      ]));
    }
  });

  it('reads product names without the sort order on databases that predate it', async () => {
    const { supabase, reads } = fakeClient((read) => {
      if (read.table !== 'daily_stock_counts') return undefined;
      return selected(read).includes('sort_order')
        ? { data: null, error: { message: 'column products_1.sort_order does not exist' } }
        : { data: [{ id: 's2', product_id: 'p2', products: { name: 'Tea' } }, { id: 's1', product_id: 'p1', products: { name: 'Cola' } }, { id: 's3', product_id: 'p0', products: null }], error: null };
    });

    const result = await loadFinanceReportRows(supabase, 'club-1', '2026-09-01', '2026-09-01', 'day');

    expect(result.error).toBeNull();
    // No configured order exists: rows go by name, a product without a name by its id.
    expect(result.data?.stockCountRows).toEqual([
      { id: 's1', product_id: 'p1', product_name: 'Cola', sort_order: null },
      { id: 's3', product_id: 'p0', product_name: null, sort_order: null },
      { id: 's2', product_id: 'p2', product_name: 'Tea', sort_order: null },
    ]);
    const retry = reads.filter((read) => read.table === 'daily_stock_counts')[1];
    expect(selected(retry)).toBe('*, products(name)');
    expect(retry.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
    // A day report reads no range totals.
    expect(result.data?.stockTotalRows).toEqual([]);
  });

  it('returns a stock count error that is not about the sort order', async () => {
    const error = { message: 'permission denied for table daily_stock_counts' };
    const { supabase, reads } = fakeClient((read) => (read.table === 'daily_stock_counts' ? { data: null, error } : undefined));
    await expect(loadFinanceReportRows(supabase, 'club-1', '2026-09-01', '2026-09-01', 'day')).resolves.toEqual({ data: null, error });
    expect(reads.filter((read) => read.table === 'daily_stock_counts')).toHaveLength(1);
  });

  it('returns fallback rows in report order with purchase names defaulted', async () => {
    const { supabase } = fakeClient((read) => ({
      daily_cash_entries: { data: [{ id: 'c1', date: '2026-09-02', cash_income: 100 }], error: null },
      daily_stock_counts: { data: [{ date: '2026-09-02', bar_income: 50, bar_cost: 30 }], error: null },
      stock_purchases: { data: [{ id: 'sp1', product_name: 'Cola' }, { id: 'sp2' }], error: null },
      expenses: { data: [{ id: 'e2', created_at: '2026-09-02T12:00:00Z' }, { id: 'e1', created_at: '2026-09-02T08:00:00Z' }], error: null },
      new_debts: { data: [{ id: 'd1', date: '2026-09-02', amount: 70 }], error: null },
    } as Record<string, Result>)[read.table]);

    const result = await loadFinanceReportRows(supabase, 'club-1', '2026-09-01', '2026-09-30', 'range');

    expect(result).toEqual({
      data: {
        cashRows: [{ id: 'c1', date: '2026-09-02', cash_income: 100 }],
        stockTotalRows: [{ date: '2026-09-02', bar_income: 50, bar_cost: 30 }],
        stockCountRows: [],
        purchaseRows: [{ id: 'sp1', product_name: 'Cola' }, { id: 'sp2', product_name: null }],
        expenseRows: [{ id: 'e1', created_at: '2026-09-02T08:00:00Z' }, { id: 'e2', created_at: '2026-09-02T12:00:00Z' }],
        debtRows: [{ id: 'd1', date: '2026-09-02', amount: 70 }],
      },
      error: null,
    });
  });
});
