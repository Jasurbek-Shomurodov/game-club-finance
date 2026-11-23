import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createDatasetLoader } from './loaders';

/** A client that fails the test if anything is read. */
function noReads() {
  const from = vi.fn(() => { throw new Error('unexpected read'); });
  const rpc = vi.fn(() => { throw new Error('unexpected read'); });
  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc };
}

describe('createDatasetLoader: upcoming', () => {
  it('returns an empty table with its period for a month other than the current one, without reading', async () => {
    const { client, from, rpc } = noReads();
    const loader = createDatasetLoader({ supabase: client, clubId: 'club-1', businessToday: '2026-11-24', role: 'owner', featureAccess: null });
    const result = await loader.load({ dataset: 'upcoming', from: '2026-10-15' });
    expect(result.table.rows).toEqual([]);
    expect(result.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(result.links.map((link) => link.href)).toEqual(['/financial-analysis?month=2026-10']);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a month after the business date as a bad period', async () => {
    const { client } = noReads();
    const loader = createDatasetLoader({ supabase: client, clubId: 'club-1', businessToday: '2026-11-24', role: 'owner', featureAccess: null });
    await expect(loader.load({ dataset: 'upcoming', from: '2026-12-01' })).rejects.toThrow('starts after its end');
  });
});

describe('createDatasetLoader: month datasets', () => {
  it('reads a month more than a year back, ignoring `to`', async () => {
    const { client } = noReads();
    const loader = createDatasetLoader({ supabase: client, clubId: 'club-1', businessToday: '2026-11-24', role: 'owner', featureAccess: null });
    const result = await loader.load({ dataset: 'upcoming', from: '2024-03-10', to: '2026-11-24' });
    expect(result.period).toEqual({ from: '2024-03-01', to: '2024-03-31' });
    expect(result.table.rows).toEqual([]);
  });

  it('checks a month without plans when the plan read fails', async () => {
    const ledgers = vi.fn().mockResolvedValue({
      cashRows: [], stockRows: [], purchaseRows: [], debtRows: [], debtPaymentRows: [], reserveMoves: [],
      expenseRows: [
        { id: 'e1', date: '2026-11-03', amount: 500_000, category: 'rent', payment_method: 'cash', payment_source: 'game_club', comment: null, created_at: null },
        { id: 'e2', date: '2026-11-03', amount: 500_000, category: 'rent', payment_method: 'cash', payment_source: 'game_club', comment: null, created_at: null },
      ],
    });
    vi.doMock('@/lib/supabase/analysisLedgers', () => ({ fetchAnalysisLedgers: ledgers }));
    vi.doMock('@/lib/supabase/expensePresets', () => ({
      fetchExpensePresets: vi.fn().mockRejectedValue(new Error('permission denied for expense_presets')),
      fetchPresetExpenses: vi.fn(),
    }));
    vi.resetModules();
    const { createDatasetLoader: createLoader } = await import('./loaders');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const loader = createLoader({ supabase: noReads().client, clubId: 'club-1', businessToday: '2026-11-24', role: 'owner', featureAccess: null });
      const result = await loader.load({ dataset: 'checks', from: '2026-11-24' });
      expect(ledgers).toHaveBeenCalledWith(expect.anything(), 'club-1', { from: '2026-08-01', to: '2026-11-30' });
      expect(result.table.rows).toEqual([expect.objectContaining({ checkKind: 'duplicate_expense', side: 'game_club', amount: 500_000, count: 2 })]);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
      vi.doUnmock('@/lib/supabase/analysisLedgers');
      vi.doUnmock('@/lib/supabase/expensePresets');
      vi.resetModules();
    }
  });
});
