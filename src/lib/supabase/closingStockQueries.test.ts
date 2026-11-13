import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/types';
import { loadClosingStockDay, type LoadClosingStockDayInput } from './closingStockQueries';

type Call = [method: string, args: unknown[]];
/** Which read a recorded query is, judged by its table and filters. */
type Kind = 'catalog' | 'savedProducts' | 'counts' | 'purchases' | 'openings';
interface RecordedQuery { table: string; rpcArgs?: unknown; calls: Call[] }
interface QueryResult { data: unknown; error: unknown }

const ok = (data: unknown): QueryResult => ({ data, error: null });
const fail = (message: string, code = '42501'): QueryResult => ({ data: null, error: { code, message } });

function kindOf(query: RecordedQuery): Kind {
  if (query.table === 'rpc:get_stock_opening_balances') return 'openings';
  if (query.table === 'daily_stock_counts') return 'counts';
  if (query.table === 'stock_purchases') return 'purchases';
  if (query.table === 'products') return query.calls.some(([method]) => method === 'in') ? 'savedProducts' : 'catalog';
  throw new Error(`Unexpected read: ${query.table}`);
}

/**
 * A chainable Supabase client that records every read. Each kind of read
 * resolves to its configured result; an array is consumed one result per
 * query of that kind (for the column fallbacks). An unconfigured kind fails
 * the test, so a read that must not happen is caught.
 */
function fakeClient(results: Partial<Record<Kind, QueryResult | QueryResult[]>>) {
  const queries: RecordedQuery[] = [];
  const served: Partial<Record<Kind, number>> = {};
  const start = (table: string, rpcArgs?: unknown) => {
    const query: RecordedQuery = { table, rpcArgs, calls: [] };
    queries.push(query);
    let result: Promise<QueryResult> | undefined;
    const settle = () => {
      const kind = kindOf(query);
      const configured = results[kind];
      if (configured === undefined) throw new Error(`Unexpected ${kind} read`);
      if (!Array.isArray(configured)) return configured;
      const index = served[kind] ?? 0;
      served[kind] = index + 1;
      if (index >= configured.length) throw new Error(`Unexpected extra ${kind} read`);
      return configured[index];
    };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'lt', 'order', 'range', 'returns']) {
      chain[method] = (...args: unknown[]) => { query.calls.push([method, args]); return chain; };
    }
    chain.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) => {
      result ??= new Promise((done) => done(settle()));
      return result.then(resolve, reject);
    };
    return chain;
  };
  const supabase = {
    from: vi.fn((table: string) => start(table)),
    rpc: vi.fn((name: string, args: unknown) => start(`rpc:${name}`, args)),
  } as unknown as SupabaseClient;
  const ofKind = (kind: Kind) => queries.filter((query) => kindOf(query) === kind);
  return { supabase, queries, ofKind };
}

const filtersOf = (query: RecordedQuery) => query.calls.filter(([method]) => method === 'eq').map(([, args]) => args);
const selectOf = (query: RecordedQuery) => String(query.calls.find(([method]) => method === 'select')?.[1][0]);
/** The part of a saved-count select that lists the count's own columns / the embedded product's columns. */
const countColumnsOf = (query: RecordedQuery) => selectOf(query).split(',products(')[0];
const productColumnsOf = (query: RecordedQuery) => selectOf(query).split(',products(')[1];

function expectClubScoped(queries: RecordedQuery[], clubId: string) {
  expect(queries.length).toBeGreaterThan(0);
  for (const query of queries) {
    if (query.table.startsWith('rpc:')) expect(query.rpcArgs).toMatchObject({ p_club_id: clubId });
    else expect(filtersOf(query)).toContainEqual(['club_id', clubId]);
  }
}

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'cola', club_id: 'club-1', name: 'Cola', category: 'Drinks', sale_price: 15_000, cost_price: 9_000,
  current_stock: 30, tracks_inventory: true, low_stock_threshold: 5, sort_order: 1, is_active: true,
  is_deleted: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
  ...overrides,
});

const TODAY = '2026-11-13';
const PAST = '2026-11-10';
const input = (overrides: Partial<LoadClosingStockDayInput> = {}): LoadClosingStockDayInput => ({
  clubId: 'club-1', date: TODAY, today: TODAY, isOwner: false, unknownProductName: 'Unknown product', ...overrides,
});

const cola = product();
const fanta = product({ id: 'fanta', name: 'Fanta', sort_order: 2 });
const purchase = { product_id: 'cola', date: TODAY, quantity: 6, cost_price: 9_000 };

describe('loadClosingStockDay: open business day', () => {
  it('loads the active catalog, saved counts, live purchases and opening balances of the club', async () => {
    const count = { product_id: 'cola', previous_stock: 24, added_today: 6, closing_stock: 27, sold_quantity: 3 };
    const { supabase, queries, ofKind } = fakeClient({
      catalog: ok([cola, fanta]),
      counts: ok([count]),
      purchases: ok([purchase]),
      openings: ok([{ product_id: 'cola', previous_stock: '24' }, { product_id: 'fanta', previous_stock: 8 }]),
    });

    const result = await loadClosingStockDay(supabase, input());

    expect(result).toEqual({
      data: {
        products: [cola, fanta],
        counts: [count],
        purchases: [purchase],
        previousClosings: { cola: 24, fanta: 8 },
        isCurrentDate: true,
        hasSavedCounts: true,
        // Something is already saved, so a stale browser draft must not replace it.
        draftEligible: false,
      },
      error: null,
    });

    // Every saved count belongs to an active product: no extra product read.
    expect(queries).toHaveLength(4);
    expectClubScoped(queries, 'club-1');
    expect(filtersOf(ofKind('catalog')[0])).toEqual([['club_id', 'club-1'], ['is_active', true], ['is_deleted', false]]);
    expect(ofKind('counts')[0].calls).toEqual([
      ['select', ['*']], ['eq', ['club_id', 'club-1']], ['eq', ['date', TODAY]], ['returns', []],
    ]);
    expect(filtersOf(ofKind('purchases')[0])).toEqual([['club_id', 'club-1'], ['date', TODAY]]);
    expect(ofKind('openings')[0].rpcArgs).toEqual({ p_club_id: 'club-1', p_before_date: TODAY });
  });

  it('lets a draft apply while nothing is saved for the day', async () => {
    const { supabase, queries } = fakeClient({
      catalog: ok([cola]), counts: ok([]), purchases: ok([]), openings: ok([]),
    });

    const result = await loadClosingStockDay(supabase, input());

    expect(result.data).toEqual({
      products: [cola], counts: [], purchases: [], previousClosings: {},
      isCurrentDate: true, hasSavedCounts: false, draftEligible: true,
    });
    expect(queries).toHaveLength(4);
  });

  it('adds inactive and archived products that already have a count today, read within the club', async () => {
    const retired = product({ id: 'retired', name: 'Retired', is_active: false });
    const archived = product({ id: 'archived', name: 'Archived', is_active: false, is_deleted: true, current_stock: 0 });
    const counts = [
      { product_id: 'cola', sold_quantity: 3 },
      { product_id: 'retired', sold_quantity: 2 },
      { product_id: 'archived', sold_quantity: 1 },
    ];
    const { supabase, queries, ofKind } = fakeClient({
      catalog: ok([cola, fanta]),
      counts: ok(counts),
      purchases: ok([]),
      openings: ok([]),
      savedProducts: ok([retired, archived]),
    });

    const result = await loadClosingStockDay(supabase, input());

    // Active catalog first, then the products kept only for their recorded sales.
    expect(result.data?.products).toEqual([cola, fanta, retired, archived]);
    expect(result.data?.counts).toEqual(counts);
    expect(queries).toHaveLength(5);
    expect(ofKind('savedProducts')[0].calls).toEqual([
      ['select', ['*']], ['eq', ['club_id', 'club-1']], ['in', ['id', ['retired', 'archived']]], ['returns', []],
    ]);
    expectClubScoped(queries, 'club-1');
  });

  it('keeps going when a saved count\'s product is not readable at all', async () => {
    const { supabase } = fakeClient({
      catalog: ok([cola]),
      counts: ok([{ product_id: 'ghost', sold_quantity: 1 }]),
      purchases: ok([]),
      openings: ok([]),
      savedProducts: ok(null),
    });

    const result = await loadClosingStockDay(supabase, input());
    expect(result.error).toBeNull();
    expect(result.data?.products).toEqual([cola]);
    expect(result.data?.hasSavedCounts).toBe(true);
  });

  it('treats responses without rows as empty', async () => {
    const { supabase } = fakeClient({
      catalog: ok(null), counts: ok(null), purchases: ok(null), openings: ok(null),
    });

    await expect(loadClosingStockDay(supabase, input())).resolves.toEqual({
      data: {
        products: [], counts: [], purchases: [], previousClosings: {},
        isCurrentDate: true, hasSavedCounts: false, draftEligible: true,
      },
      error: null,
    });
  });

  it('loads a date after today as an open day that is not the current date', async () => {
    const future = '2026-11-14';
    const { supabase, ofKind } = fakeClient({
      catalog: ok([cola]), counts: ok([]), purchases: ok([]), openings: ok([]),
    });

    const result = await loadClosingStockDay(supabase, input({ date: future }));

    expect(result.data).toMatchObject({ isCurrentDate: false, hasSavedCounts: false, draftEligible: true });
    expect(filtersOf(ofKind('counts')[0])).toContainEqual(['date', future]);
    expect(filtersOf(ofKind('purchases')[0])).toContainEqual(['date', future]);
    expect(ofKind('openings')[0].rpcArgs).toEqual({ p_club_id: 'club-1', p_before_date: future });
  });

  it.each<[Kind, string]>([
    ['catalog', 'products denied'],
    ['counts', 'counts denied'],
    ['purchases', 'purchases denied'],
    ['openings', 'openings denied'],
  ])('returns the %s error and no data', async (kind, message) => {
    const { supabase, ofKind } = fakeClient({
      catalog: ok([cola]),
      counts: ok([{ product_id: 'retired' }]),
      purchases: ok([]),
      openings: ok([]),
      [kind]: fail(message),
    });

    await expect(loadClosingStockDay(supabase, input()))
      .resolves.toEqual({ data: null, error: { code: '42501', message } });
    // Nothing further is read after a failure.
    expect(ofKind('savedProducts')).toHaveLength(0);
  });

  it('returns the error of the read for inactive products with counts', async () => {
    const { supabase } = fakeClient({
      catalog: ok([cola]),
      counts: ok([{ product_id: 'retired' }]),
      purchases: ok([]),
      openings: ok([]),
      savedProducts: fail('saved products denied'),
    });

    await expect(loadClosingStockDay(supabase, input()))
      .resolves.toEqual({ data: null, error: { code: '42501', message: 'saved products denied' } });
  });

  it('reads the active catalog without sort_order on an older database', async () => {
    const { supabase, ofKind } = fakeClient({
      catalog: [fail('column products.sort_order does not exist', '42703'), ok([cola])],
      counts: ok([]),
      purchases: ok([]),
      openings: ok([]),
    });

    const result = await loadClosingStockDay(supabase, input());

    expect(result.data?.products).toEqual([cola]);
    expect(ofKind('catalog')).toHaveLength(2);
    expect(ofKind('catalog')[1].calls.filter(([method]) => method === 'order')).toEqual([['order', ['name', { ascending: true }]]]);
    expectClubScoped(ofKind('catalog'), 'club-1');
  });
});

describe('loadClosingStockDay: past date', () => {
  const relation = {
    id: 'cola', club_id: 'club-1', name: 'Cola', category: 'Drinks', current_stock: 30, tracks_inventory: true,
    low_stock_threshold: 5, sort_order: 3, is_active: true, is_deleted: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
  };
  const savedCount = (overrides: Record<string, unknown> = {}) => ({
    product_id: 'cola', previous_stock: 10, added_today: 2, adjustment_quantity: 0, adjustment_reason: null,
    closing_stock: 7, sold_quantity: 5, sale_price: 12_000, cost_price: 8_000, giveaway_quantity: 0, promotion_id: null,
    products: relation,
    ...overrides,
  });
  const pastPurchase = { product_id: 'cola', date: PAST, quantity: 2, cost_price: 8_000 };

  it('shows the saved snapshot with the prices saved on each count, not the catalog', async () => {
    const counts = [savedCount()];
    const { supabase, queries, ofKind } = fakeClient({ counts: ok(counts), purchases: ok([pastPurchase]) });

    const result = await loadClosingStockDay(supabase, input({ date: PAST, isOwner: true }));

    expect(result).toEqual({
      data: {
        products: [{
          id: 'cola', club_id: 'club-1', name: 'Cola', category: 'Drinks',
          // The count's saved prices, whatever the product costs today.
          sale_price: 12_000, cost_price: 8_000,
          current_stock: 30, tracks_inventory: true, low_stock_threshold: 5, sort_order: 3,
          is_active: true, is_deleted: false,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
        }],
        counts,
        purchases: [pastPurchase],
        // A saved historical opening is a snapshot: no opening balances are recomputed.
        previousClosings: {},
        isCurrentDate: false,
        hasSavedCounts: true,
        draftEligible: false,
      },
      error: null,
    });

    // Only the saved counts and that date's purchases are read: no catalog, no openings.
    expect(queries).toHaveLength(2);
    expectClubScoped(queries, 'club-1');
    const countsQuery = ofKind('counts')[0];
    expect(filtersOf(countsQuery)).toEqual([['club_id', 'club-1'], ['date', PAST]]);
    expect(countsQuery.calls).toContainEqual(['order', ['updated_at', { ascending: false }]]);
    expect(countColumnsOf(countsQuery).split(',')).toEqual(expect.arrayContaining([
      'product_id', 'previous_stock', 'added_today', 'adjustment_quantity', 'adjustment_reason',
      'closing_stock', 'sold_quantity', 'sale_price', 'cost_price', 'giveaway_quantity', 'promotion_id',
    ]));
    expect(productColumnsOf(countsQuery)).toContain('sort_order');
    expect(filtersOf(ofKind('purchases')[0])).toEqual([['club_id', 'club-1'], ['date', PAST]]);
  });

  it('accepts the embedded product as a one-element array', async () => {
    const tea = { ...relation, id: 'tea', name: 'Tea', tracks_inventory: false, is_active: false, is_deleted: true, current_stock: 0 };
    const { supabase } = fakeClient({
      counts: ok([savedCount({ product_id: 'tea', sale_price: '5000', cost_price: '1500.5', closing_stock: 0, products: [tea] })]),
      purchases: ok([]),
    });

    const result = await loadClosingStockDay(supabase, input({ date: PAST }));

    expect(result.data?.products).toEqual([{
      id: 'tea', club_id: 'club-1', name: 'Tea', category: 'Drinks',
      sale_price: 5_000, cost_price: 1_500.5,
      current_stock: 0, tracks_inventory: false, low_stock_threshold: 5, sort_order: 3,
      is_active: false, is_deleted: true,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
    }]);
  });

  it.each([
    ['null', null],
    ['absent', undefined],
    ['an empty array', []],
  ])('names a count whose product is not readable (%s) and keeps it read-only', async (_label, products) => {
    const { supabase } = fakeClient({
      counts: ok([savedCount({ product_id: 'gone', closing_stock: '4', sale_price: 7_000, cost_price: 3_000, products })]),
      purchases: ok([]),
    });

    const result = await loadClosingStockDay(supabase, input({ date: PAST, unknownProductName: 'Deleted product' }));

    expect(result.data?.products).toEqual([{
      id: 'gone', club_id: 'club-1', name: 'Deleted product', category: null,
      sale_price: 7_000, cost_price: 3_000,
      // Without the product row, the saved closing stands in for live stock.
      current_stock: 4, tracks_inventory: true, low_stock_threshold: null, sort_order: null,
      // Inactive, so the page shows the row but cannot write it.
      is_active: false, is_deleted: false,
      created_at: '', updated_at: '',
    }]);
  });

  it('reads missing saved prices and closing as zero', async () => {
    const { supabase } = fakeClient({
      counts: ok([savedCount({ product_id: 'gone', closing_stock: null, sale_price: null, cost_price: null, products: null })]),
      purchases: ok([]),
    });

    const result = await loadClosingStockDay(supabase, input({ date: PAST }));
    expect(result.data?.products[0]).toMatchObject({ sale_price: 0, cost_price: 0, current_stock: 0 });
  });

  it('fills the columns an older product row does not have', async () => {
    const older = {
      id: 'cola', club_id: 'club-1', name: 'Cola', category: null, current_stock: 0, low_stock_threshold: null,
      is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
    };
    const { supabase } = fakeClient({ counts: ok([savedCount({ products: older })]), purchases: ok([]) });

    const result = await loadClosingStockDay(supabase, input({ date: PAST }));

    expect(result.data?.products).toEqual([{
      ...older,
      sale_price: 12_000, cost_price: 8_000,
      // The product's own zero stock is kept; the saved closing (7) is not substituted.
      current_stock: 0,
      tracks_inventory: true, sort_order: null, is_deleted: false,
    }]);
  });

  it('gives an owner the active catalog with openings when nothing was saved for the date', async () => {
    const { supabase, queries, ofKind } = fakeClient({
      counts: ok([]),
      purchases: ok([pastPurchase]),
      catalog: ok([cola, fanta]),
      openings: ok([{ product_id: 'cola', previous_stock: 10 }]),
    });

    const result = await loadClosingStockDay(supabase, input({ date: PAST, isOwner: true }));

    expect(result).toEqual({
      data: {
        products: [cola, fanta],
        counts: [],
        purchases: [pastPurchase],
        previousClosings: { cola: 10 },
        isCurrentDate: false,
        hasSavedCounts: false,
        draftEligible: true,
      },
      error: null,
    });
    expect(queries).toHaveLength(4);
    expectClubScoped(queries, 'club-1');
    expect(filtersOf(ofKind('catalog')[0])).toEqual([['club_id', 'club-1'], ['is_active', true], ['is_deleted', false]]);
    expect(ofKind('openings')[0].rpcArgs).toEqual({ p_club_id: 'club-1', p_before_date: PAST });
  });

  it('treats owner responses without rows as empty', async () => {
    const { supabase } = fakeClient({ counts: ok(null), purchases: ok(null), catalog: ok(null), openings: ok(null) });

    await expect(loadClosingStockDay(supabase, input({ date: PAST, isOwner: true }))).resolves.toEqual({
      data: {
        products: [], counts: [], purchases: [], previousClosings: {},
        isCurrentDate: false, hasSavedCounts: false, draftEligible: true,
      },
      error: null,
    });
  });

  it('shows a non-owner an empty, non-editable day when nothing was saved', async () => {
    const { supabase, queries } = fakeClient({ counts: ok([]), purchases: ok([pastPurchase]) });

    const result = await loadClosingStockDay(supabase, input({ date: PAST, isOwner: false }));

    expect(result).toEqual({
      data: {
        products: [], counts: [], purchases: [pastPurchase], previousClosings: {},
        isCurrentDate: false, hasSavedCounts: false, draftEligible: false,
      },
      error: null,
    });
    // The catalog and openings are not read for someone who cannot create a past closing.
    expect(queries).toHaveLength(2);
  });

  it('returns the saved-counts error', async () => {
    const { supabase, queries } = fakeClient({ counts: fail('counts denied'), purchases: ok([]) });

    await expect(loadClosingStockDay(supabase, input({ date: PAST, isOwner: true })))
      .resolves.toEqual({ data: null, error: { code: '42501', message: 'counts denied' } });
    expect(queries).toHaveLength(2);
  });

  it('returns the purchases error', async () => {
    const { supabase, queries } = fakeClient({ counts: ok([]), purchases: fail('purchases denied') });

    await expect(loadClosingStockDay(supabase, input({ date: PAST, isOwner: true })))
      .resolves.toEqual({ data: null, error: { code: '42501', message: 'purchases denied' } });
    expect(queries).toHaveLength(2);
  });

  it.each<[Kind, string]>([
    ['catalog', 'products denied'],
    ['openings', 'openings denied'],
  ])('returns the owner\'s %s error', async (kind, message) => {
    const { supabase } = fakeClient({
      counts: ok([]), purchases: ok([]), catalog: ok([cola]), openings: ok([]), [kind]: fail(message),
    });

    await expect(loadClosingStockDay(supabase, input({ date: PAST, isOwner: true })))
      .resolves.toEqual({ data: null, error: { code: '42501', message } });
  });

  describe('older databases', () => {
    const noGiveaway = fail('column daily_stock_counts.giveaway_quantity does not exist', '42703');
    const noSortOrder = fail('column products_1.sort_order does not exist', '42703');
    const legacyCount = savedCount({ giveaway_quantity: undefined, promotion_id: undefined });

    it('reads counts without the giveaway columns before migration 078', async () => {
      const { supabase, ofKind } = fakeClient({ counts: [noGiveaway, ok([legacyCount])], purchases: ok([]) });

      const result = await loadClosingStockDay(supabase, input({ date: PAST }));

      expect(result.data?.counts).toEqual([legacyCount]);
      expect(result.data?.hasSavedCounts).toBe(true);
      const [first, second] = ofKind('counts');
      expect(ofKind('counts')).toHaveLength(2);
      expect(countColumnsOf(first)).toContain('giveaway_quantity');
      expect(countColumnsOf(second)).not.toContain('giveaway_quantity');
      expect(countColumnsOf(second)).not.toContain('promotion_id');
      // Only the missing columns are dropped.
      expect(productColumnsOf(second)).toContain('sort_order');
      expect(countColumnsOf(second).split(',')).toEqual(expect.arrayContaining(['closing_stock', 'sold_quantity', 'sale_price', 'cost_price']));
      expectClubScoped(ofKind('counts'), 'club-1');
    });

    it('reads the embedded product without sort_order before the ordering migration', async () => {
      const { supabase, ofKind } = fakeClient({ counts: [noSortOrder, ok([savedCount()])], purchases: ok([]) });

      const result = await loadClosingStockDay(supabase, input({ date: PAST }));

      expect(result.data?.products).toHaveLength(1);
      expect(ofKind('counts')).toHaveLength(2);
      const second = ofKind('counts')[1];
      expect(productColumnsOf(second)).not.toContain('sort_order');
      expect(countColumnsOf(second)).toContain('giveaway_quantity');
      expect(filtersOf(second)).toEqual([['club_id', 'club-1'], ['date', PAST]]);
    });

    it('drops both when the database reports the giveaway columns first', async () => {
      const { supabase, ofKind } = fakeClient({
        counts: [noGiveaway, noSortOrder, noGiveaway, ok([legacyCount])],
        purchases: ok([]),
      });

      const result = await loadClosingStockDay(supabase, input({ date: PAST }));

      expect(result.error).toBeNull();
      expect(result.data?.counts).toEqual([legacyCount]);
      const last = ofKind('counts')[3];
      expect(countColumnsOf(last)).not.toContain('giveaway_quantity');
      expect(productColumnsOf(last)).not.toContain('sort_order');
      expectClubScoped(ofKind('counts'), 'club-1');
    });

    it('drops both when the database reports sort_order first', async () => {
      const { supabase, ofKind } = fakeClient({
        counts: [noSortOrder, noGiveaway, ok([legacyCount])],
        purchases: ok([]),
      });

      const result = await loadClosingStockDay(supabase, input({ date: PAST }));

      expect(result.data?.counts).toEqual([legacyCount]);
      expect(ofKind('counts')).toHaveLength(3);
      const last = ofKind('counts')[2];
      expect(countColumnsOf(last)).not.toContain('giveaway_quantity');
      expect(productColumnsOf(last)).not.toContain('sort_order');
    });

    it('does not retry an unrelated error', async () => {
      const { supabase, ofKind } = fakeClient({ counts: fail('permission denied'), purchases: ok([]) });

      const result = await loadClosingStockDay(supabase, input({ date: PAST }));
      expect(result).toEqual({ data: null, error: { code: '42501', message: 'permission denied' } });
      expect(ofKind('counts')).toHaveLength(1);
    });

    it('returns an error without a message as is', async () => {
      const { supabase, ofKind } = fakeClient({ counts: { data: null, error: { code: 'XX000' } }, purchases: ok([]) });

      const result = await loadClosingStockDay(supabase, input({ date: PAST }));
      expect(result).toEqual({ data: null, error: { code: 'XX000' } });
      expect(ofKind('counts')).toHaveLength(1);
    });
  });
});
