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

describe('createDatasetLoader: outlook', () => {
  const emptyLedgers = { cashRows: [], stockRows: [], purchaseRows: [], debtRows: [], debtPaymentRows: [], reserveMoves: [], expenseRows: [] };
  const balance = (earned: number, withdrawn: number) => ({ earned, withdrawn, available: earned - withdrawn, overdrawnBy: 0 });

  async function outlookLoader(options: {
    role: 'owner' | 'admin';
    featureAccess: unknown;
    presets?: () => Promise<unknown>;
    ledgers?: () => Promise<unknown>;
    ownerMoney?: () => Promise<unknown>;
    reserve?: () => Promise<unknown>;
  }) {
    const ledgers = vi.fn(options.ledgers ?? (() => Promise.resolve({
      ...emptyLedgers,
      cashRows: [{ id: 'c1', date: '2026-11-02', cash_income: 2_000_000, terminal_income: 0, card_income: 0, playstation_income: 0 }],
    })));
    const reserve = vi.fn(options.reserve ?? (() => Promise.resolve({
      reserveEntries: [{ id: 'r1', source: 'game_club', kind: 'deposit', amount: 4_000_000, payment_method: 'cash' }],
      reserveExpenses: [],
      exchangeRows: [],
      dollarExpenses: [],
      reserveSupported: true,
    })));
    const ownerMoney = vi.fn(options.ownerMoney ?? (() => Promise.resolve({
      balancesByMonth: { '2026-11': { gameClub: balance(2_000_000, 500_000), bar: balance(0, 0), hasOverWithdrawal: false, invalidWithdrawals: [] } },
      // Owner Profit's read carries the reserve ledgers too.
      reserveEntries: [{ id: 'r1', source: 'game_club', kind: 'deposit', amount: 4_000_000, payment_method: 'cash' }],
      reserveExpenses: [],
      reserveSupported: true,
    })));
    vi.doMock('@/lib/supabase/analysisLedgers', () => ({ fetchAnalysisLedgers: ledgers }));
    vi.doMock('@/lib/supabase/expensePresets', () => ({
      fetchExpensePresets: vi.fn(options.presets ?? (() => Promise.resolve({ presets: [], available: true }))),
      fetchPresetExpenses: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('@/lib/supabase/ownerMoney', () => ({ fetchOwnerReserve: reserve, fetchOwnerMoney: ownerMoney }));
    vi.doMock('@/lib/supabase/moneyExchanges', () => ({ fetchMoneyExchanges: vi.fn().mockResolvedValue([]) }));
    vi.doMock('@/lib/supabase/reserveMoves', () => ({ fetchReserveMoves: vi.fn().mockResolvedValue([]) }));
    vi.resetModules();
    const { createDatasetLoader: createLoader } = await import('./loaders');
    const rpc = vi.fn().mockResolvedValue({
      data: { cash: [{ id: 'c1', date: '2026-11-02', cash_income: 2_000_000, terminal_income: 0, card_income: 0, playstation_income: 0 }] },
      error: null,
    });
    const supabase = { from: vi.fn(() => { throw new Error('unexpected read'); }), rpc } as unknown as SupabaseClient;
    const loader = createLoader({ supabase, clubId: 'club-1', businessToday: '2026-11-24', role: options.role, featureAccess: options.featureAccess });
    return { loader, ledgers, reserve, ownerMoney, rpc };
  }

  function cleanup() {
    for (const path of ['@/lib/supabase/analysisLedgers', '@/lib/supabase/expensePresets', '@/lib/supabase/ownerMoney', '@/lib/supabase/moneyExchanges', '@/lib/supabase/reserveMoves']) {
      vi.doUnmock(path);
    }
    vi.resetModules();
  }

  it('gives an owner the forecast, what is still due, money left, withdrawals and the reserve for the current month', async () => {
    try {
      const { loader, ledgers, reserve, ownerMoney } = await outlookLoader({ role: 'owner', featureAccess: null });
      // Any period asked for, the outlook is the current business month.
      const result = await loader.load({ dataset: 'outlook', from: '2026-09-01', to: '2026-09-30' });
      expect(ledgers).toHaveBeenCalledWith(expect.anything(), 'club-1', { from: '2026-10-01', to: '2026-11-24' });
      expect(ownerMoney).toHaveBeenCalledTimes(1);
      expect(ownerMoney).toHaveBeenCalledWith(expect.anything(), 'club-1', '2026-11-24');
      // The reserve comes from Owner Profit's read, not a second one.
      expect(reserve).not.toHaveBeenCalled();
      expect(result.period).toEqual({ from: '2026-11-01', to: '2026-11-24' });
      const value = (metric: string) => result.table.rows.find((row) => row.metric === metric)?.value;
      expect(value('daysLeft')).toBe(6);
      expect(value('gameClubIncomeToDate')).toBe(2_000_000);
      expect(value('gameClubStillDue')).toBe(0);
      expect(value('gameClubMoneyLeftCash')).toBe(2_000_000);
      expect(value('gameClubOwnerWithdrawn')).toBe(500_000);
      expect(value('gameClubLeftAfterWithdrawals')).toBe(1_500_000);
      expect(value('reserveSums')).toBe(4_000_000);
      expect(result.unavailable).toEqual([]);
      expect(result.links.map((link) => link.href)).toEqual(expect.arrayContaining(['/money-taken', '/reserve?view=history']));
    } finally {
      cleanup();
    }
  });

  it('reports what is still due on its own and keeps it out of the profit forecast', async () => {
    try {
      const { loader } = await outlookLoader({
        role: 'owner',
        featureAccess: null,
        presets: () => Promise.resolve({
          presets: [{ id: 'p1', name: 'Rent', category: 'rent', payment_source: 'game_club', payment_method: 'cash', monthly_amount: 1_000_000, sort_order: 0, archived_at: null }],
          available: true,
        }),
        ledgers: () => Promise.resolve({
          ...emptyLedgers,
          cashRows: [
            { id: 'c1', date: '2026-11-01', cash_income: 2_000_000, terminal_income: 0, card_income: 0, playstation_income: 0 },
            { id: 'c2', date: '2026-11-20', cash_income: 2_000_000, terminal_income: 0, card_income: 0, playstation_income: 0 },
          ],
        }),
      });
      const result = await loader.load({ dataset: 'outlook' });
      const value = (metric: string) => result.table.rows.find((row) => row.metric === metric)?.value;
      // 4 000 000 over 20 counted days is 6 000 000 over November's 30. The 1 000 000 rent
      // still due is its own figure: the forecast counts expenses as paid so far, as Financial Analysis does.
      expect(value('gameClubStillDue')).toBe(1_000_000);
      expect(value('gameClubProjectedIncome')).toBe(6_000_000);
      expect(value('gameClubProjectedProfit')).toBe(6_000_000);
    } finally {
      cleanup();
    }
  });

  it('marks parts outside the member access as no_access without reading them; the reserve is never a gap for a non-owner', async () => {
    try {
      const { loader, reserve, ownerMoney, rpc } = await outlookLoader({ role: 'admin', featureAccess: ['assistant', 'dashboard'] });
      const result = await loader.load({ dataset: 'outlook' });
      const metrics = result.table.rows.map((row) => row.metric);
      expect(metrics).toContain('gameClubProjectedProfit');
      expect(metrics).toContain('gameClubStillDue');
      for (const missing of ['gameClubMoneyLeftCash', 'gameClubMoneyLeft', 'barMoneyLeft', 'gameClubOwnerWithdrawn', 'barLeftAfterWithdrawals', 'reserveSums']) {
        expect(metrics).not.toContain(missing);
      }
      expect(result.unavailable).toEqual([
        { part: 'moneyLeft', reason: 'no_access' },
        { part: 'ownerWithdrawals', reason: 'no_access' },
      ]);
      expect(rpc).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
      expect(ownerMoney).not.toHaveBeenCalled();
      expect(result.links.map((link) => link.href)).not.toContain('/reserve?view=history');
    } finally {
      cleanup();
    }
  });

  it('marks parts whose read failed as read_failed, and features not set up as not_set_up', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { loader, reserve } = await outlookLoader({
        role: 'owner',
        featureAccess: null,
        presets: () => Promise.reject(new Error('permission denied for expense_presets')),
        ownerMoney: () => Promise.reject(new Error('connection reset')),
        reserve: () => Promise.resolve({ reserveEntries: [], reserveExpenses: [], exchangeRows: [], dollarExpenses: [], reserveSupported: false }),
      });
      const result = await loader.load({ dataset: 'outlook' });
      const metrics = result.table.rows.map((row) => row.metric);
      for (const missing of ['gameClubStillDue', 'barStillDue', 'gameClubOwnerWithdrawn', 'reserveSums']) expect(metrics).not.toContain(missing);
      expect(metrics).toContain('gameClubMoneyLeft');
      expect(result.unavailable).toEqual([
        { part: 'stillDue', reason: 'read_failed' },
        { part: 'ownerWithdrawals', reason: 'read_failed' },
        { part: 'reserve', reason: 'not_set_up' },
      ]);
      expect(error).toHaveBeenCalledTimes(2);
      // Owner Profit's read failed, so the reserve is read on its own.
      expect(reserve).toHaveBeenCalledWith(expect.anything(), 'club-1', '2026-11-24');
      expect(result.links.map((link) => link.href)).not.toContain('/money-taken');
    } finally {
      error.mockRestore();
      cleanup();
    }
  });

  it('keeps the rest of the outlook when the forecast read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { loader } = await outlookLoader({ role: 'owner', featureAccess: null, ledgers: () => Promise.reject(new Error('timeout')) });
      const result = await loader.load({ dataset: 'outlook' });
      const metrics = result.table.rows.map((row) => row.metric);
      for (const missing of ['gameClubIncomeToDate', 'gameClubProjectedProfit', 'gameClubProjectedProfitRest', 'barSalesToDate', 'barProjectedProfitRest']) {
        expect(metrics).not.toContain(missing);
      }
      expect(result.table.rows.find((row) => row.metric === 'daysLeft')?.value).toBe(6);
      expect(metrics).toEqual(expect.arrayContaining(['gameClubStillDue', 'gameClubMoneyLeft', 'gameClubLeftAfterWithdrawals', 'reserveSums']));
      expect(result.unavailable).toEqual([{ part: 'forecast', reason: 'read_failed' }]);
    } finally {
      error.mockRestore();
      cleanup();
    }
  });
});
