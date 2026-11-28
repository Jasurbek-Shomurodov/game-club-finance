import { describe, expect, it } from 'vitest';
import { fakeSupabase } from './__tests__/fakeSupabase';
import { fetchOwnerBotDay, summarizeOwnerBotDay } from './day';

const CLUB = '10000000-0000-0000-0000-000000000001';
const OTHER = '10000000-0000-0000-0000-000000000002';
// 10:00 in Tashkent on 28 November: the last closed business day is the 27th.
const NOW = new Date('2026-11-28T05:00:00Z');

const tables = {
  clubs: [{ id: CLUB, business_day_start_hour: 0, enabled_payment_methods: ['cash', 'terminal'] }],
  daily_cash_entries: [
    { club_id: CLUB, date: '2026-11-27', cash_income: 1_200_000, terminal_income: 800_000, card_income: 0, playstation_income: 150_000 },
    { club_id: CLUB, date: '2026-11-28', cash_income: 999_000, terminal_income: 0, card_income: 0, playstation_income: 0 },
    { club_id: OTHER, date: '2026-11-27', cash_income: 5_000_000, terminal_income: 0, card_income: 0, playstation_income: 0 },
  ],
  expenses: [
    { club_id: CLUB, id: 'e1', date: '2026-11-27', amount: 100_000, category: 'other', payment_method: 'terminal', payment_source: 'game_club', paid_from_reserve: false, comment: null, created_at: '' },
    // Paid by the bar: takes nothing from a Game Club method.
    { club_id: CLUB, id: 'e2', date: '2026-11-27', amount: 70_000, category: 'other', payment_method: 'cash', payment_source: 'bar', paid_from_reserve: false, comment: null, created_at: '' },
  ],
  debt_payments: [{ club_id: CLUB, id: 'p1', date: '2026-11-27', amount: 50_000, payment_method: 'cash' }],
  daily_stock_counts: [
    { club_id: CLUB, product_id: 'a', date: '2026-11-27', bar_income: 300_000 },
    { club_id: CLUB, product_id: 'b', date: '2026-11-27', bar_income: 150_000 },
    { club_id: OTHER, product_id: 'a', date: '2026-11-27', bar_income: 9_000_000 },
  ],
};

describe('owner bot day', () => {
  it('reads the club\'s last closed business day, scoped to that club', async () => {
    const { supabase, reads } = fakeSupabase({ tables });
    const day = await fetchOwnerBotDay(supabase, { id: CLUB, name: 'Square' }, NOW);
    expect(day).toEqual({
      clubName: 'Square',
      businessDate: '2026-11-27',
      methods: [
        { method: 'cash', moneyIn: 1_250_000, moneyOut: 0, net: 1_250_000 },
        { method: 'terminal', moneyIn: 800_000, moneyOut: 100_000, net: 700_000 },
        { method: 'playstation', moneyIn: 150_000, moneyOut: 0, net: 150_000 },
      ],
      barSales: 450_000,
    });
    for (const read of reads) expect(read.filters).toMatchObject(read.table === 'clubs' ? { id: CLUB } : { club_id: CLUB, date: '2026-11-27' });
  });

  it('follows the club\'s business-day start hour', async () => {
    // A club whose day starts at 12:00 is still on the 27th at 10:00, so its last closed day is the 26th.
    const { supabase, reads } = fakeSupabase({ tables: { ...tables, clubs: [{ ...tables.clubs[0], business_day_start_hour: 12 }] } });
    const day = await fetchOwnerBotDay(supabase, { id: CLUB, name: 'Square' }, NOW);
    expect(day.businessDate).toBe('2026-11-26');
    expect(day.methods).toEqual([]);
    expect(reads.find((read) => read.table === 'expenses')?.filters.date).toBe('2026-11-26');
  });

  it('fails when a ledger cannot be read, never showing a partial day', async () => {
    const { supabase } = fakeSupabase({ tables, failTables: ['expenses'] });
    await expect(fetchOwnerBotDay(supabase, { id: CLUB, name: 'Square' }, NOW)).rejects.toMatchObject({ message: 'expenses unavailable' });
  });

  it('shows the enabled methods once any method moved money', () => {
    const day = summarizeOwnerBotDay({
      clubName: 'Square',
      businessDate: '2026-11-27',
      enabledPaymentMethods: ['cash', 'card'],
      cashRows: [{ date: '2026-11-27', cash_income: 0, terminal_income: 0, card_income: 10_000 }],
      expenseRows: [],
      debtPaymentRows: [],
      stockRows: [],
    });
    expect(day.methods.map((item) => item.method)).toEqual(['cash', 'card']);
    expect(day.barSales).toBe(0);
  });
});
