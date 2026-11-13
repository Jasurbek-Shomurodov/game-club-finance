import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  escapeLikePattern,
  fetchActiveProductsOrdered,
  fetchProductIdsByName,
  fetchProductsOrdered,
  isMissingDeletedColumn,
  isMissingSortOrder,
  updateProductSortOrders,
} from './products';

type Call = [method: string, args: unknown[]];
interface RecordedQuery { table: string; calls: Call[] }
interface QueryResult { data: unknown; error: unknown }

/**
 * A chainable Supabase query builder that records every filter. Each
 * `from()` starts a new recorded query; awaiting it resolves to what
 * `respond` returns for that query (by order of creation).
 */
function fakeClient(respond: (query: RecordedQuery, index: number) => QueryResult) {
  const queries: RecordedQuery[] = [];
  const from = vi.fn((table: string) => {
    const query: RecordedQuery = { table, calls: [] };
    const index = queries.push(query) - 1;
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'update', 'eq', 'ilike', 'order', 'limit', 'returns']) {
      chain[method] = (...args: unknown[]) => { query.calls.push([method, args]); return chain; };
    }
    chain.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(respond(query, index)).then(resolve, reject);
    return chain;
  });
  return { supabase: { from } as unknown as SupabaseClient, from, queries };
}

const filtersOf = (query: RecordedQuery) => query.calls.filter(([method]) => method === 'eq').map(([, args]) => args);
const ordersOf = (query: RecordedQuery) => query.calls.filter(([method]) => method === 'order').map(([, args]) => args);

const cola = { id: 'cola', club_id: 'club-1', name: 'Cola' };
const missingSortOrder = { code: '42703', message: 'column products.sort_order does not exist' };
const missingDeleted = { code: '42703', message: 'column products.is_deleted does not exist' };

describe('missing column detection', () => {
  it('recognises only an error that names the column', () => {
    expect(isMissingSortOrder(missingSortOrder)).toBe(true);
    expect(isMissingSortOrder(missingDeleted)).toBe(false);
    expect(isMissingDeletedColumn(missingDeleted)).toBe(true);
    expect(isMissingDeletedColumn(missingSortOrder)).toBe(false);
  });

  it('treats no error and an error without a message as not missing', () => {
    for (const error of [null, undefined, {}]) {
      expect(isMissingSortOrder(error)).toBe(false);
      expect(isMissingDeletedColumn(error)).toBe(false);
    }
  });
});

describe('fetchProductsOrdered', () => {
  it('reads the club\'s non-archived products in catalog order', async () => {
    const { supabase, queries } = fakeClient(() => ({ data: [cola], error: null }));

    await expect(fetchProductsOrdered(supabase, 'club-1')).resolves.toEqual({ data: [cola], error: null });

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe('products');
    expect(queries[0].calls[0]).toEqual(['select', ['*']]);
    // Inactive and made-to-order products are part of the full catalog.
    expect(filtersOf(queries[0])).toEqual([['club_id', 'club-1'], ['is_deleted', false]]);
    expect(ordersOf(queries[0])).toEqual([['sort_order', { ascending: true }], ['name', { ascending: true }]]);
  });

  it('narrows to active and stock-tracked products on request', async () => {
    const { supabase, queries } = fakeClient(() => ({ data: [], error: null }));

    await fetchProductsOrdered(supabase, 'club-1', { activeOnly: true, tracksInventoryOnly: true });

    expect(filtersOf(queries[0])).toEqual([
      ['club_id', 'club-1'], ['is_active', true], ['tracks_inventory', true], ['is_deleted', false],
    ]);
  });

  it('orders by name alone before the sort_order migration, keeping the archive filter', async () => {
    const { supabase, queries } = fakeClient((_query, index) =>
      index === 0 ? { data: null, error: missingSortOrder } : { data: [cola], error: null });

    await expect(fetchProductsOrdered(supabase, 'club-1', { activeOnly: true }))
      .resolves.toEqual({ data: [cola], error: null });

    expect(queries).toHaveLength(2);
    expect(ordersOf(queries[1])).toEqual([['name', { ascending: true }]]);
    expect(filtersOf(queries[1])).toEqual([['club_id', 'club-1'], ['is_active', true], ['is_deleted', false]]);
  });

  it('drops only the archive filter before the archive migration, keeping catalog order', async () => {
    const { supabase, queries } = fakeClient((_query, index) =>
      index === 0 ? { data: null, error: missingDeleted } : { data: [cola], error: null });

    await expect(fetchProductsOrdered(supabase, 'club-1')).resolves.toEqual({ data: [cola], error: null });

    expect(queries).toHaveLength(2);
    expect(filtersOf(queries[1])).toEqual([['club_id', 'club-1']]);
    expect(ordersOf(queries[1])).toEqual([['sort_order', { ascending: true }], ['name', { ascending: true }]]);
  });

  it('drops both columns one at a time on a database missing both, still club-scoped', async () => {
    const { supabase, queries } = fakeClient((_query, index) => {
      if (index === 0) return { data: null, error: missingSortOrder };
      if (index === 1) return { data: null, error: missingDeleted };
      return { data: [cola], error: null };
    });

    await expect(fetchProductsOrdered(supabase, 'club-1', { tracksInventoryOnly: true }))
      .resolves.toEqual({ data: [cola], error: null });

    expect(queries).toHaveLength(3);
    expect(filtersOf(queries[2])).toEqual([['club_id', 'club-1'], ['tracks_inventory', true]]);
    expect(ordersOf(queries[2])).toEqual([['name', { ascending: true }]]);
    expect(queries.every((query) => filtersOf(query).some(([key, value]) => key === 'club_id' && value === 'club-1'))).toBe(true);
  });

  it('handles the columns going missing in the other order too', async () => {
    const { supabase, queries } = fakeClient((_query, index) => {
      if (index === 0) return { data: null, error: missingDeleted };
      if (index === 1) return { data: null, error: missingSortOrder };
      return { data: [cola], error: null };
    });

    await expect(fetchProductsOrdered(supabase, 'club-1')).resolves.toEqual({ data: [cola], error: null });
    expect(queries).toHaveLength(3);
    expect(filtersOf(queries[2])).toEqual([['club_id', 'club-1']]);
    expect(ordersOf(queries[2])).toEqual([['name', { ascending: true }]]);
  });

  it('returns an unrelated error without retrying', async () => {
    const denied = { code: '42501', message: 'permission denied for table products' };
    const { supabase, queries } = fakeClient(() => ({ data: null, error: denied }));

    await expect(fetchProductsOrdered(supabase, 'club-1')).resolves.toEqual({ data: null, error: denied });
    expect(queries).toHaveLength(1);
  });

  it('stops when the same missing-column error persists after the column was dropped', async () => {
    const { supabase, queries } = fakeClient(() => ({ data: null, error: missingSortOrder }));

    await expect(fetchProductsOrdered(supabase, 'club-1')).resolves.toEqual({ data: null, error: missingSortOrder });
    expect(queries).toHaveLength(2);
  });

  it('stops after both fallbacks are used up', async () => {
    const { supabase, queries } = fakeClient((_query, index) =>
      ({ data: null, error: index === 0 ? missingSortOrder : missingDeleted }));

    await expect(fetchProductsOrdered(supabase, 'club-1')).resolves.toEqual({ data: null, error: missingDeleted });
    expect(queries).toHaveLength(3);
  });
});

describe('fetchActiveProductsOrdered', () => {
  it('always filters to active products of the club', async () => {
    const { supabase, queries } = fakeClient(() => ({ data: [cola], error: null }));

    await expect(fetchActiveProductsOrdered(supabase, 'club-1')).resolves.toEqual({ data: [cola], error: null });
    expect(filtersOf(queries[0])).toEqual([['club_id', 'club-1'], ['is_active', true], ['is_deleted', false]]);
  });

  it('passes the stock-tracked filter through', async () => {
    const { supabase, queries } = fakeClient(() => ({ data: [], error: null }));

    await fetchActiveProductsOrdered(supabase, 'club-1', { tracksInventoryOnly: true });
    expect(filtersOf(queries[0])).toEqual([
      ['club_id', 'club-1'], ['is_active', true], ['tracks_inventory', true], ['is_deleted', false],
    ]);
  });
});

describe('updateProductSortOrders', () => {
  afterEach(() => { vi.useRealTimers(); });

  const swap = [{ id: 'cola', sort_order: 2 }, { id: 'fanta', sort_order: 1 }];
  const idOf = (query: RecordedQuery) => filtersOf(query).find(([key]) => key === 'id')?.[1];

  it('writes each position scoped to the club and the product', async () => {
    const { supabase, queries } = fakeClient((query) => ({ data: [{ id: idOf(query) }], error: null }));

    await expect(updateProductSortOrders(supabase, 'club-1', swap, '2026-11-13T10:00:00.000Z'))
      .resolves.toEqual({ error: null });

    expect(queries.map((query) => query.table)).toEqual(['products', 'products']);
    expect(queries[0].calls).toEqual([
      ['update', [{ sort_order: 2, updated_at: '2026-11-13T10:00:00.000Z' }]],
      ['eq', ['club_id', 'club-1']],
      ['eq', ['id', 'cola']],
      ['select', ['id']],
    ]);
    expect(queries[1].calls).toEqual([
      ['update', [{ sort_order: 1, updated_at: '2026-11-13T10:00:00.000Z' }]],
      ['eq', ['club_id', 'club-1']],
      ['eq', ['id', 'fanta']],
      ['select', ['id']],
    ]);
  });

  it('stamps the current time when none is given', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T08:30:00.000Z'));
    const { supabase, queries } = fakeClient(() => ({ data: [{ id: 'cola' }], error: null }));

    await updateProductSortOrders(supabase, 'club-1', [swap[0]]);
    expect(queries[0].calls[0]).toEqual(['update', [{ sort_order: 2, updated_at: '2026-11-13T08:30:00.000Z' }]]);
  });

  it('reports a failed write', async () => {
    const denied = { code: '42501', message: 'permission denied' };
    const { supabase } = fakeClient((query) =>
      idOf(query) === 'fanta' ? { data: null, error: denied } : { data: [{ id: 'cola' }], error: null });

    await expect(updateProductSortOrders(supabase, 'club-1', swap)).resolves.toEqual({ error: denied });
  });

  it('treats a write that updated no rows as a failure (RLS filters silently)', async () => {
    const { supabase } = fakeClient((query) =>
      ({ data: idOf(query) === 'fanta' ? [] : [{ id: 'cola' }], error: null }));

    await expect(updateProductSortOrders(supabase, 'club-1', swap)).resolves.toEqual({ error: { message: 'no rows updated' } });
  });

  it('treats a write that returned no data at all as a failure', async () => {
    const { supabase } = fakeClient(() => ({ data: null, error: null }));

    await expect(updateProductSortOrders(supabase, 'club-1', swap)).resolves.toEqual({ error: { message: 'no rows updated' } });
  });

  it('makes no request and succeeds when nothing has to move', async () => {
    const { supabase, from } = fakeClient(() => ({ data: [], error: null }));

    await expect(updateProductSortOrders(supabase, 'club-1', [])).resolves.toEqual({ error: null });
    expect(from).not.toHaveBeenCalled();
  });
});

describe('escapeLikePattern', () => {
  it('escapes LIKE wildcards and the escape character itself', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%');
    expect(escapeLikePattern('red_bull')).toBe('red\\_bull');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
    expect(escapeLikePattern('100%_\\')).toBe('100\\%\\_\\\\');
  });

  it('leaves ordinary text unchanged', () => {
    expect(escapeLikePattern('Coca-Cola 0.5')).toBe('Coca-Cola 0.5');
    expect(escapeLikePattern('')).toBe('');
  });
});

describe('fetchProductIdsByName', () => {
  it('makes no query for a blank search', async () => {
    const { supabase, from } = fakeClient(() => ({ data: [{ id: 'cola' }], error: null }));

    await expect(fetchProductIdsByName(supabase, 'club-1', '')).resolves.toEqual({ data: [], error: null });
    await expect(fetchProductIdsByName(supabase, 'club-1', '   ')).resolves.toEqual({ data: [], error: null });
    expect(from).not.toHaveBeenCalled();
  });

  it('searches every product of the club by a trimmed, case-insensitive name fragment', async () => {
    const { supabase, queries } = fakeClient(() => ({ data: [{ id: 'cola' }, { id: 'cola-zero' }], error: null }));

    await expect(fetchProductIdsByName(supabase, 'club-1', '  cola ')).resolves.toEqual({ data: ['cola', 'cola-zero'], error: null });

    // No is_active / is_deleted filter: history searches must find archived products.
    expect(queries[0]).toEqual({
      table: 'products',
      calls: [
        ['select', ['id']],
        ['eq', ['club_id', 'club-1']],
        ['ilike', ['name', '%cola%']],
        ['limit', [100]],
      ],
    });
  });

  it('matches typed wildcards literally', async () => {
    const { supabase, queries } = fakeClient(() => ({ data: [], error: null }));

    await fetchProductIdsByName(supabase, 'club-1', '50%_off');
    expect(queries[0].calls).toContainEqual(['ilike', ['name', '%50\\%\\_off%']]);
  });

  it('honours a custom limit', async () => {
    const { supabase, queries } = fakeClient(() => ({ data: [], error: null }));

    await fetchProductIdsByName(supabase, 'club-1', 'cola', 5);
    expect(queries[0].calls).toContainEqual(['limit', [5]]);
  });

  it('returns the error with no ids', async () => {
    const denied = { code: '42501', message: 'permission denied' };
    const { supabase } = fakeClient(() => ({ data: [{ id: 'leaked' }], error: denied }));

    await expect(fetchProductIdsByName(supabase, 'club-1', 'cola')).resolves.toEqual({ data: [], error: denied });
  });

  it('returns no ids when the response carries no rows', async () => {
    const { supabase } = fakeClient(() => ({ data: null, error: null }));

    await expect(fetchProductIdsByName(supabase, 'club-1', 'cola')).resolves.toEqual({ data: [], error: null });
  });
});
