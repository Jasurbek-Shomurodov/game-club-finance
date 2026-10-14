import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDashboardDataFromSnapshot,
  getDashboardSnapshotRanges,
} from '@/lib/calculations/dashboardSnapshot';
import {
  fetchDashboardSnapshot,
  fetchDashboardSnapshotFromTables,
  normalizeDashboardSnapshotPayload,
} from './dashboardSnapshot';

const ranges = getDashboardSnapshotRanges('2026-10-14');

const product = {
  id: 'cola',
  club_id: 'club-1',
  name: 'Cola',
  category: 'Drinks',
  sale_price: 5_000,
  cost_price: 3_000,
  current_stock: 3,
  low_stock_threshold: 5,
  tracks_inventory: true,
  is_active: true,
  created_at: '',
  updated_at: '',
};

// Raw table rows for one club, as the fallback reads them.
const tables: Record<string, Array<Record<string, unknown>>> = {
  daily_cash_entries: [
    { id: 'c1', date: '2026-09-05', cash_income: 100_000, terminal_income: 20_000, card_income: 0, playstation_income: 5_000, created_at: '2026-09-05T10:00:00Z' },
    { id: 'c2', date: '2026-09-20', cash_income: 999_000, terminal_income: 0, card_income: 0, playstation_income: 0, created_at: '2026-09-20T10:00:00Z' },
    { id: 'c3', date: '2026-10-03', cash_income: 150_000, terminal_income: 0, card_income: 30_000, playstation_income: 0, created_at: '2026-10-03T10:00:00Z' },
  ],
  daily_stock_counts: [
    { product_id: 'cola', date: '2026-09-30', bar_income: 50_000, bar_profit: 20_000, bar_cost: 30_000, sold_quantity: 10, closing_stock: 4, cost_price: 3_000, updated_at: '2026-09-30T20:00:00Z', products: { tracks_inventory: true } },
    { product_id: 'chips', date: '2026-09-30', bar_income: 8_000, bar_profit: 3_000, bar_cost: 5_000, sold_quantity: 2, closing_stock: 6, cost_price: 2_500, updated_at: '2026-09-30T20:00:00Z', products: { tracks_inventory: true } },
    { product_id: 'cola', date: '2026-10-02', bar_income: 25_000, bar_profit: 10_000, bar_cost: 15_000, sold_quantity: 5, closing_stock: 3, cost_price: 3_000, updated_at: '2026-10-02T20:00:00Z', products: { tracks_inventory: true } },
    { product_id: 'chips', date: '2026-10-02', bar_income: 4_000, bar_profit: 1_500, bar_cost: 2_500, sold_quantity: 1, closing_stock: 5, cost_price: 2_500, updated_at: '2026-10-02T20:00:00Z', products: { tracks_inventory: true } },
  ],
  expenses: [
    { id: 'e1', date: '2026-09-10', amount: 40_000, category: 'rent', payment_method: 'cash', payment_source: 'game_club', comment: null, created_at: '' },
    { id: 'e2', date: '2026-10-04', amount: 7_000, category: 'supplies', payment_method: 'cash', payment_source: 'bar', comment: null, created_at: '' },
  ],
  products: [product],
  new_debts: [
    { id: 'd1', date: '2026-03-01', amount: 9_000, remaining_amount: 9_000, status: 'unpaid' },
    { id: 'd2', date: '2026-09-12', amount: 20_000, remaining_amount: 0, status: 'paid' },
    { id: 'd3', date: '2026-10-05', amount: 12_000, remaining_amount: 2_000, status: 'partial' },
  ],
  debt_payments: [
    { id: 'p1', date: '2026-10-06', amount: 10_000, payment_method: 'terminal' },
  ],
  stock_purchases: [
    { id: 's1', date: '2026-10-01', quantity: 10, cost_price: 3_000 },
  ],
};

/** A chainable stand-in for the PostgREST builder that filters by date. */
function fakeTableClient() {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        gte: (column: string, value: string) => {
          filters.push((row) => String(row[column]) >= value);
          return builder;
        },
        lte: (column: string, value: string) => {
          filters.push((row) => String(row[column]) <= value);
          return builder;
        },
        range: async (from: number, to: number) => ({
          data: tables[table].filter((row) => filters.every((filter) => filter(row))).slice(from, to + 1),
          error: null,
        }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

/** What get_dashboard_snapshot returns for the same rows (per-day stock sums). */
function rpcPayloadForSameRows() {
  const financeFrom = ranges.previousRange.from;
  const financeTo = ranges.range.to;
  const inFinance = (row: Record<string, unknown>) => String(row.date) >= financeFrom && String(row.date) <= financeTo;
  const stockByDate = new Map<string, Record<string, number | string>>();
  for (const row of tables.daily_stock_counts.filter(inFinance)) {
    const date = String(row.date);
    const total = stockByDate.get(date) ?? { date, bar_income: 0, bar_profit: 0, bar_cost: 0, sold_quantity: 0 };
    for (const key of ['bar_income', 'bar_profit', 'bar_cost', 'sold_quantity'] as const) {
      total[key] = Number(total[key]) + Number(row[key]);
    }
    stockByDate.set(date, total);
  }
  return {
    cashRows: tables.daily_cash_entries.filter(inFinance),
    stockRows: Array.from(stockByDate.values()),
    inventoryRows: tables.daily_stock_counts.filter(
      (row) => String(row.date) >= ranges.inventoryComparisonRange.from && String(row.date) <= ranges.inventoryComparisonRange.to,
    ),
    purchaseRows: tables.stock_purchases.filter(inFinance),
    expenseRows: tables.expenses.filter(inFinance),
    debtRows: tables.new_debts.filter((row) => row.status !== 'paid' || inFinance(row)),
    debtPaymentRows: tables.debt_payments.filter(inFinance),
    products: tables.products,
  };
}

describe('dashboard snapshot loading', () => {
  it('compares the current month-to-date with the same days of last month', () => {
    expect(ranges.range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(ranges.previousRange).toEqual({ from: '2026-09-01', to: '2026-09-14' });
    expect(ranges.inventoryComparisonRange).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('calls the RPC with every range and normalizes the payload', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { cashRows: [], stockRows: [{ date: '2026-10-01' }] }, error: null });
    const result = await fetchDashboardSnapshot({ rpc } as unknown as SupabaseClient, 'club-1', ranges);

    expect(rpc).toHaveBeenCalledWith('get_dashboard_snapshot', {
      p_club_id: 'club-1',
      p_range_from: '2026-10-01',
      p_range_to: '2026-10-31',
      p_previous_from: '2026-09-01',
      p_previous_to: '2026-09-14',
      p_inventory_from: '2026-09-01',
      p_inventory_to: '2026-09-30',
    });
    expect(result.fallbackRequired).toBe(false);
    // Older RPC versions without inventoryRows reuse stockRows.
    expect(result.data?.inventoryRows).toEqual([{ date: '2026-10-01' }]);
    expect(result.data?.products).toEqual([]);
  });

  it('asks for the fallback only when the RPC is missing', async () => {
    const missing = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    expect(await fetchDashboardSnapshot({ rpc: missing } as unknown as SupabaseClient, 'club-1', ranges))
      .toEqual({ data: null, error: null, fallbackRequired: true });

    const denied = { code: '42501', message: 'Not authorized for this club.' };
    const failing = vi.fn().mockResolvedValue({ data: null, error: denied });
    expect(await fetchDashboardSnapshot({ rpc: failing } as unknown as SupabaseClient, 'club-1', ranges))
      .toEqual({ data: null, error: denied, fallbackRequired: false });
  });

  it('builds identical dashboard data from the RPC and the table fallback', async () => {
    const fallback = await fetchDashboardSnapshotFromTables(fakeTableClient(), 'club-1', ranges);
    expect(fallback.error).toBeNull();

    const fromTables = buildDashboardDataFromSnapshot({ ...ranges, payload: fallback.data! });
    const fromRpc = buildDashboardDataFromSnapshot({
      ...ranges,
      payload: normalizeDashboardSnapshotPayload(rpcPayloadForSameRows()),
    });

    expect(fromTables).toEqual(fromRpc);
    // Guard against a vacuous match: the shared rows produce real figures.
    expect(fromRpc.totals.barSales).toBe(29_000);
    expect(fromRpc.previousTotals.gameClubIncome).toBe(145_000);
    expect(fromRpc.totals.activeDebts).toBe(11_000);
    expect(fromRpc.inventoryComparisonValue).toBe(27_000);
  });
});
