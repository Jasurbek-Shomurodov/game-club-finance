import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fetchFinanceReportSnapshot, loadFinanceReportRows } from './financeReportSnapshot';

describe('fetchFinanceReportSnapshot', () => {
  it('requests the selected sections and normalizes missing arrays', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { cashRows: [{ id: 'cash-1' }] },
      error: null,
    });
    const supabase = { rpc } as unknown as SupabaseClient;

    const result = await fetchFinanceReportSnapshot(
      supabase,
      'club-1',
      '2026-09-01',
      '2026-09-30',
      ['cash', 'expenses'],
    );

    expect(rpc).toHaveBeenCalledWith('get_finance_report_snapshot', {
      p_club_id: 'club-1',
      p_range_from: '2026-09-01',
      p_range_to: '2026-09-30',
      p_sections: ['cash', 'expenses'],
    });
    expect(result.fallbackRequired).toBe(false);
    expect(result.error).toBeNull();
    expect(result.data?.cashRows).toEqual([{ id: 'cash-1' }]);
    expect(result.data?.expenseRows).toEqual([]);
  });

  it('requests the compatibility path only when the RPC is missing', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'Function was not found' },
      }),
    } as unknown as SupabaseClient;

    const result = await fetchFinanceReportSnapshot(
      supabase,
      'club-1',
      '2026-09-01',
      '2026-09-01',
      ['cash'],
    );

    expect(result).toEqual({ data: null, error: null, fallbackRequired: true });
  });

  it('surfaces database errors without running a fallback', async () => {
    const databaseError = { code: '42501', message: 'Not authorized' };
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: databaseError }),
    } as unknown as SupabaseClient;

    const result = await fetchFinanceReportSnapshot(
      supabase,
      'club-1',
      '2026-09-01',
      '2026-09-01',
      ['cash'],
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe(databaseError);
    expect(result.fallbackRequired).toBe(false);
  });
});

const missingRpc = { data: null, error: { code: 'PGRST202', message: 'Function was not found' } };

/** A table read whose every filter/order call chains and whose page resolves to `results[table]`. */
function tableClient(results: Record<string, { data: unknown[] | null; error: { message: string } | null }>) {
  const selects: Array<{ table: string; columns: string }> = [];
  const from = vi.fn((table: string) => {
    const builder = {
      select: (columns: string) => { selects.push({ table, columns }); return builder; },
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      range: () => Promise.resolve(results[table] ?? { data: [], error: null }),
    };
    return builder;
  });
  return { from, selects, rpc: vi.fn().mockResolvedValue(missingRpc) };
}

describe('loadFinanceReportRows', () => {
  it('orders snapshot expenses by creation time and stock rows by product order', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          expenseRows: [
            { id: 'a', created_at: '2026-09-01T12:00:00Z' },
            { id: 'b', created_at: '2026-09-01T09:00:00Z' },
          ],
          stockCountRows: [
            { product_id: 'p2', product_name: 'Tea', sort_order: 2 },
            { product_id: 'p1', product_name: 'Cola', sort_order: 1 },
          ],
        },
        error: null,
      }),
    } as unknown as SupabaseClient;

    const result = await loadFinanceReportRows(supabase, 'club-1', '2026-09-01', '2026-09-01', 'day');

    expect(supabase.rpc).toHaveBeenCalledWith('get_finance_report_snapshot', expect.objectContaining({
      p_sections: ['cash', 'stock_counts', 'purchases', 'expenses', 'debts'],
    }));
    expect(result.error).toBeNull();
    expect(result.data?.expenseRows.map((row) => row.id)).toEqual(['b', 'a']);
    expect(result.data?.stockCountRows.map((row) => row.product_id)).toEqual(['p1', 'p2']);
  });

  it('falls back to table reads and flattens joined product names', async () => {
    const client = tableClient({
      daily_stock_counts: {
        data: [
          { id: 's2', product_id: 'p2', products: { name: 'Tea', sort_order: 2 } },
          { id: 's1', product_id: 'p1', products: { name: 'Cola', sort_order: 1 } },
        ],
        error: null,
      },
      new_debts: { data: [{ id: 'd1', date: '2026-09-01', amount: 500 }], error: null },
    });

    const result = await loadFinanceReportRows(client as unknown as SupabaseClient, 'club-1', '2026-09-01', '2026-09-01', 'day');

    expect(result.error).toBeNull();
    expect(result.data?.stockCountRows).toEqual([
      { id: 's1', product_id: 'p1', product_name: 'Cola', sort_order: 1 },
      { id: 's2', product_id: 'p2', product_name: 'Tea', sort_order: 2 },
    ]);
    expect(result.data?.debtRows).toEqual([{ id: 'd1', date: '2026-09-01', amount: 500 }]);
    expect(client.selects).toContainEqual({ table: 'daily_stock_counts', columns: '*, products(name, sort_order)' });
  });

  it('reads only stock totals for a range and surfaces fallback errors', async () => {
    const client = tableClient({ expenses: { data: null, error: { message: 'denied' } } });

    const result = await loadFinanceReportRows(client as unknown as SupabaseClient, 'club-1', '2026-09-01', '2026-09-30', 'range');

    expect(result).toEqual({ data: null, error: { message: 'denied' } });
    expect(client.selects).toContainEqual({ table: 'daily_stock_counts', columns: 'date,bar_income,bar_cost' });
    expect(client.selects.filter((select) => select.table === 'daily_stock_counts')).toHaveLength(1);
  });
});
