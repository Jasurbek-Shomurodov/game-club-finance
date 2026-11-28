import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchDashboardSnapshot, fetchDashboardSnapshotFromTables, normalizeDashboardSnapshotPayload } from './dashboardSnapshot';

type Result = { data: unknown; error: unknown };
type Call = [string, unknown[]];
interface Read { table: string; calls: Call[] }

const selected = (read: Read) => String(read.calls.find(([name]) => name === 'select')?.[1][0] ?? '');
const ordersBy = (read: Read, column: string) => read.calls.some(([name, args]) => name === 'order' && args[0] === column);

/** Every `from(table)` starts a fresh chainable read; `answer` decides its page. `rpc` serves the reserve moves (156). */
function fakeClient(answer: (read: Read) => Result | undefined = () => undefined) {
  const reads: Read[] = [];
  const from = vi.fn((table: string) => {
    const read: Read = { table, calls: [] };
    reads.push(read);
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gt', 'gte', 'lt', 'lte', 'in', 'order', 'range']) {
      chain[method] = (...args: unknown[]) => { read.calls.push([method, args]); return chain; };
    }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(answer(read) ?? { data: [], error: null }).then(resolve);
    return chain;
  });
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  return { supabase: { from, rpc } as unknown as SupabaseClient, reads };
}

const isActiveProductsRead = (read: Read) => read.table === 'products' && read.calls.some(([name, args]) => name === 'eq' && args[0] === 'is_active' && args[1] === true);
const isInactiveStockRead = (read: Read) => read.table === 'products' && read.calls.some(([name, args]) => name === 'eq' && args[0] === 'is_active' && args[1] === false);

const ranges = {
  range: { from: '2026-10-01', to: '2026-10-14' },
  previousRange: { from: '2026-09-01', to: '2026-09-14' },
  inventoryComparisonRange: { from: '2026-09-01', to: '2026-09-30' },
};
const empty = { cashRows: [], stockRows: [], inventoryRows: [], purchaseRows: [], expenseRows: [], debtRows: [], debtPaymentRows: [], products: [] };

describe('normalizeDashboardSnapshotPayload', () => {
  it('is an empty dashboard for a null or empty payload', () => {
    expect(normalizeDashboardSnapshotPayload(null)).toEqual(empty);
    expect(normalizeDashboardSnapshotPayload(undefined)).toEqual(empty);
    expect(normalizeDashboardSnapshotPayload({})).toEqual(empty);
  });

  it('lets stock rows stand in for inventory rows on older deployments', () => {
    const stockRows = [{ date: '2026-10-02', bar_income: 10, product_id: 'p1', closing_stock: 4, cost_price: 2 }];
    const normalized = normalizeDashboardSnapshotPayload({ stockRows });
    expect(normalized.stockRows).toBe(stockRows);
    expect(normalized.inventoryRows).toBe(stockRows);
  });

  it('keeps separate inventory rows when the RPC returns them', () => {
    const stockRows = [{ date: '2026-10-02', bar_income: 10 }];
    const inventoryRows = [{ product_id: 'p1', date: '2026-09-30', closing_stock: 4, cost_price: 2 }];
    const normalized = normalizeDashboardSnapshotPayload({ stockRows, inventoryRows, products: [{ id: 'p1' }] });
    expect(normalized.inventoryRows).toBe(inventoryRows);
    expect(normalized.products).toEqual([{ id: 'p1' }]);
    expect(normalized.debtPaymentRows).toEqual([]);
  });
});

describe('fetchDashboardSnapshot', () => {
  it('returns other RPC errors without asking for the fallback', async () => {
    const error = { code: '42501', message: 'Not authorized' };
    const { supabase: tables } = fakeClient();
    const supabase = { from: tables.from, rpc: vi.fn().mockResolvedValue({ data: null, error }) } as unknown as SupabaseClient;
    await expect(fetchDashboardSnapshot(supabase, 'club-1', ranges)).resolves.toEqual({ data: null, error, fallbackRequired: false });
  });

  it('is an empty dashboard when the RPC returns nothing', async () => {
    const { supabase: tables } = fakeClient();
    const supabase = { from: tables.from, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) } as unknown as SupabaseClient;
    // Nothing moved in or out of the reserve either (156), and no product is deactivated with stock.
    await expect(fetchDashboardSnapshot(supabase, 'club-1', ranges)).resolves.toEqual({
      data: { ...empty, reserveMoves: [], inactiveStockProducts: [], earlierInventoryRows: [] },
      error: null,
      fallbackRequired: false,
    });
  });
});

describe('fetchDashboardSnapshotFromTables', () => {
  const FINANCE_TABLES = ['daily_cash_entries', 'expenses', 'debt_payments', 'stock_purchases'];
  const isInventoryRead = (read: Read) => read.table === 'daily_stock_counts' && selected(read).includes('closing_stock');

  it('scopes every read to the club and reads finance rows once for both periods', async () => {
    const { supabase, reads } = fakeClient();
    await fetchDashboardSnapshotFromTables(supabase, 'club-1', ranges);

    // Seven ledgers, the active catalog, the deactivated products still holding stock (B4)
    // and the whole catalog for older counts (none needed: it is empty here).
    expect(reads).toHaveLength(10);
    for (const read of reads) expect(read.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
    // Current 1-14 October and previous 1-14 September: one read from 1 September to 14 October.
    for (const read of reads.filter((item) => FINANCE_TABLES.includes(item.table))) {
      expect(read.calls).toEqual(expect.arrayContaining([['gte', ['date', '2026-09-01']], ['lte', ['date', '2026-10-14']]]));
    }
    expect(reads.find(isInventoryRead)!.calls).toEqual(expect.arrayContaining([['gte', ['date', '2026-09-01']], ['lte', ['date', '2026-09-30']]]));
    // Unpaid debts count whatever their date, so debts are not date-limited.
    const debts = reads.find((read) => read.table === 'new_debts')!;
    expect(debts.calls.some(([name]) => name === 'gte' || name === 'lte')).toBe(false);
    expect(reads.find(isActiveProductsRead)).toBeDefined();
    expect(reads.find(isInactiveStockRead)!.calls).toEqual(expect.arrayContaining([
      ['eq', ['is_deleted', false]],
      ['gt', ['current_stock', 0]],
    ]));
    // Expenses carry the reserve flag, as on the RPC path (156).
    expect(selected(reads.find((read) => read.table === 'expenses')!)).toContain('paid_from_reserve');
  });

  it('reads expenses without the reserve flag on a database that predates it', async () => {
    const expenses = [{ id: 'e1', date: '2026-10-02', amount: 30 }];
    const { supabase, reads } = fakeClient((read) => {
      if (read.table !== 'expenses') return undefined;
      return selected(read).includes('paid_from_reserve')
        ? { data: null, error: { code: '42703', message: 'column expenses.paid_from_reserve does not exist' } }
        : { data: expenses, error: null };
    });

    const result = await fetchDashboardSnapshotFromTables(supabase, 'club-1', ranges);

    expect(result.error).toBeNull();
    expect(result.data?.expenseRows).toEqual(expenses);
    const retry = reads.filter((read) => read.table === 'expenses')[1];
    expect(retry.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
  });

  it('reads the latest older count of each product with none in the comparison window', async () => {
    const window = [{ product_id: 'cola', date: '2026-09-30', closing_stock: 4, cost_price: 5 }];
    const older = [
      { product_id: 'chips', date: '2026-08-20', closing_stock: 10, cost_price: 4 },
      { product_id: 'chips', date: '2026-07-01', closing_stock: 30, cost_price: 4 },
    ];
    const { supabase, reads } = fakeClient((read) => {
      if (read.table === 'products' && selected(read) === 'id,tracks_inventory,deleted_at') {
        return { data: [{ id: 'cola' }, { id: 'chips', deleted_at: null }], error: null };
      }
      if (read.table === 'daily_stock_counts' && read.calls.some(([name]) => name === 'lt')) return { data: older, error: null };
      if (isInventoryRead(read)) return { data: window, error: null };
      return undefined;
    });

    const result = await fetchDashboardSnapshotFromTables(supabase, 'club-1', ranges);

    expect(result.data?.earlierInventoryRows).toEqual([older[0]]);
    const earlier = reads.find((read) => read.table === 'daily_stock_counts' && read.calls.some(([name]) => name === 'lt'))!;
    expect(earlier.calls).toEqual(expect.arrayContaining([
      ['eq', ['club_id', 'club-1']],
      ['in', ['product_id', ['chips']]],
      ['lt', ['date', '2026-09-01']],
      ['order', ['date', { ascending: false }]],
    ]));
    const catalogRead = reads.find((read) => read.table === 'products' && selected(read) === 'id,tracks_inventory,deleted_at')!;
    expect(catalogRead.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
  });

  it('passes the reserve moves like the RPC path', async () => {
    const { supabase } = fakeClient();
    const move = { date: '2026-10-03', source: 'game_club', method: 'cash', amount: 5_000 };
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [move], error: null });

    const result = await fetchDashboardSnapshotFromTables(supabase, 'club-1', ranges);

    expect(supabase.rpc).toHaveBeenCalledWith('get_reserve_moves', { p_club_id: 'club-1', p_from: '2026-09-01', p_to: '2026-10-14' });
    expect(result.data?.reserveMoves).toEqual([move]);
  });

  it('reads a past month\'s later debt payments and the paid debts they belong to instead of the deactivated stock', async () => {
    const payments = [{ id: 'p1', debt_id: 'd1', date: '2026-10-05', amount: 40 }];
    const paidDebt = { id: 'd1', person_name: 'Ali', date: '2026-08-20', amount: 40, remaining_amount: 0, status: 'paid' };
    const { supabase, reads } = fakeClient((read) => {
      if (read.table === 'debt_payments' && read.calls.some(([name]) => name === 'gt')) return { data: payments, error: null };
      if (read.table === 'new_debts' && read.calls.some(([name]) => name === 'in')) return { data: [paidDebt], error: null };
      return undefined;
    });

    const result = await fetchDashboardSnapshotFromTables(supabase, 'club-1', {
      period: 'lastMonth',
      range: { from: '2026-09-01', to: '2026-09-30' },
      previousRange: { from: '2026-08-01', to: '2026-08-31' },
      inventoryComparisonRange: { from: '2026-08-01', to: '2026-08-31' },
    });

    expect(result.data?.laterDebtPayments).toEqual(payments);
    expect(result.data?.laterPaidDebts).toEqual([paidDebt]);
    expect(reads.find(isInactiveStockRead)).toBeUndefined();
    const later = reads.find((read) => read.table === 'debt_payments' && read.calls.some(([name]) => name === 'gt'))!;
    expect(later.calls).toEqual(expect.arrayContaining([['eq', ['club_id', 'club-1']], ['gt', ['date', '2026-09-30']]]));
    const debts = reads.find((read) => read.table === 'new_debts' && read.calls.some(([name]) => name === 'in'))!;
    expect(debts.calls).toEqual(expect.arrayContaining([
      ['eq', ['club_id', 'club-1']],
      ['eq', ['status', 'paid']],
      ['lte', ['date', '2026-09-30']],
      ['in', ['id', ['d1']]],
    ]));
  });

  it('covers both periods whichever one is earlier', async () => {
    const { supabase, reads } = fakeClient();
    await fetchDashboardSnapshotFromTables(supabase, 'club-1', {
      ...ranges,
      range: { from: '2026-08-01', to: '2026-08-31' },
      previousRange: { from: '2026-09-01', to: '2026-09-30' },
    });
    const cash = reads.find((read) => read.table === 'daily_cash_entries')!;
    expect(cash.calls).toEqual(expect.arrayContaining([['gte', ['date', '2026-08-01']], ['lte', ['date', '2026-09-30']]]));
  });

  it('builds the payload from the table rows', async () => {
    const rows: Record<string, unknown[]> = {
      daily_cash_entries: [{ date: '2026-10-02', cash_income: 100 }],
      expenses: [{ id: 'e1', date: '2026-10-02', amount: 30 }],
      products: [{ id: 'p1', name: 'Cola' }],
      new_debts: [{ id: 'd1', date: '2026-08-01', amount: 50, remaining_amount: 50, status: 'open' }],
      debt_payments: [{ id: 'dp1', date: '2026-10-03', amount: 20, payment_method: 'cash' }],
      stock_purchases: [{ id: 'sp1', date: '2026-10-02', quantity: 2, cost_price: 5 }],
    };
    const stock = [{ date: '2026-10-02', bar_income: 40, bar_cost: 25 }];
    const inventory = [{ product_id: 'p1', date: '2026-09-30', closing_stock: 4, cost_price: 5 }];
    const inactive = [{ id: 'p2', current_stock: 3, cost_price: 4 }];
    const { supabase } = fakeClient((read) => {
      if (read.table === 'daily_stock_counts') return { data: isInventoryRead(read) ? inventory : stock, error: null };
      if (isInactiveStockRead(read)) return { data: inactive, error: null };
      return { data: rows[read.table], error: null };
    });

    await expect(fetchDashboardSnapshotFromTables(supabase, 'club-1', ranges)).resolves.toEqual({
      data: {
        cashRows: rows.daily_cash_entries,
        stockRows: stock,
        inventoryRows: inventory,
        purchaseRows: rows.stock_purchases,
        expenseRows: rows.expenses,
        debtRows: rows.new_debts,
        debtPaymentRows: rows.debt_payments,
        products: rows.products,
        reserveMoves: [],
        inactiveStockProducts: inactive,
        // p1 has a count in the comparison window: no older count is read.
        earlierInventoryRows: [],
      },
      error: null,
    });
  });

  it('orders products by name on databases without the sort order column', async () => {
    const products = [{ id: 'p1', name: 'Cola' }];
    const { supabase, reads } = fakeClient((read) => {
      if (read.table !== 'products') return undefined;
      return ordersBy(read, 'sort_order')
        ? { data: null, error: { message: 'column products.sort_order does not exist' } }
        : { data: products, error: null };
    });

    const result = await fetchDashboardSnapshotFromTables(supabase, 'club-1', ranges);

    expect(result.error).toBeNull();
    expect(result.data?.products).toEqual(products);
    const retry = reads.filter(isActiveProductsRead)[1];
    // The retry is still this club's active products.
    expect(retry.calls).toEqual(expect.arrayContaining([['eq', ['club_id', 'club-1']], ['eq', ['is_active', true]], ['order', ['name', { ascending: true }]]]));
    expect(ordersBy(retry, 'sort_order')).toBe(false);
  });

  it.each(['daily_cash_entries', 'daily_stock_counts', 'expenses', 'products', 'new_debts', 'debt_payments', 'stock_purchases'])(
    'returns a failed %s read as the error instead of partial totals',
    async (table) => {
      const error = { message: `permission denied for table ${table}` };
      const { supabase } = fakeClient((read) => (read.table === table ? { data: null, error } : undefined));
      await expect(fetchDashboardSnapshotFromTables(supabase, 'club-1', ranges)).resolves.toEqual({ data: null, error });
    },
  );
});
