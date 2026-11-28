import type { SupabaseClient } from '@supabase/supabase-js';

/** A table read the owner bot made: the table and its eq() filters. */
export interface FakeRead {
  table: string;
  filters: Record<string, unknown>;
}

type TableRows = Record<string, Array<Record<string, unknown>>>;
export type RpcAnswer = (args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string; hint?: string } | null };

/**
 * Just enough of supabase-js for the owner bot: from().select().eq()…order()
 * then range() or maybeSingle(), filtered by the eq() columns, and rpc().
 */
export function fakeSupabase({
  tables = {},
  rpc = {},
  failTables = [],
}: { tables?: TableRows; rpc?: Record<string, RpcAnswer>; failTables?: string[] } = {}) {
  const reads: FakeRead[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      reads.push({ table, filters });
      const rows = () => (tables[table] ?? []).filter((row) => Object.entries(filters).every(([column, value]) => row[column] === value));
      const fail = failTables.includes(table) ? { message: `${table} unavailable` } : null;
      const builder = {
        select: () => builder,
        order: () => builder,
        eq(column: string, value: unknown) { filters[column] = value; return builder; },
        range: (from: number, to: number) => Promise.resolve(fail ? { data: null, error: fail } : { data: rows().slice(from, to + 1), error: null }),
        maybeSingle: () => Promise.resolve(fail ? { data: null, error: fail } : { data: rows()[0] ?? null, error: null }),
        single: () => Promise.resolve(fail ? { data: null, error: fail } : { data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'not found' } }),
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      const answer = rpc[name];
      return Promise.resolve(answer ? answer(args) : { data: null, error: { message: `function ${name} does not exist`, code: 'PGRST202' } });
    },
  };
  return { supabase: client as unknown as SupabaseClient, reads, rpcCalls };
}
