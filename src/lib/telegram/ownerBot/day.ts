import type { SupabaseClient } from '@supabase/supabase-js';
import { sumBarSales, type BarSalesRow } from '../../calculations/barMoney';
import {
  calculateGameClubDayByPaymentMethod,
  type DailyCashRow,
  type DebtPaymentValueRow,
  type ExpenseRow,
} from '../../calculations/dashboardMetrics';
import { fetchAllRows } from '../../supabase/pagination';
import type { EntryPaymentMethod } from '@/types';
import { selectDayPaymentMethods } from '../dailyFinanceReport';
import {
  getClubBusinessDayStartHour,
  getEnabledPaymentMethods,
  previousClubBusinessDateIso,
} from '../sendDailyFinanceReport';
import type { OwnerBotClub } from './accounts';
import type { OwnerBotDay } from './texts';

export interface OwnerBotDayRows {
  clubName: string;
  businessDate: string;
  enabledPaymentMethods: readonly EntryPaymentMethod[];
  cashRows: DailyCashRow[];
  expenseRows: ExpenseRow[];
  debtPaymentRows: DebtPaymentValueRow[];
  stockRows: BarSalesRow[];
}

/**
 * One club's day as the daily report's "Оплаты за день" section and bar sales
 * count it: the same functions, so the bot and the report always agree.
 */
export function summarizeOwnerBotDay(rows: OwnerBotDayRows): OwnerBotDay {
  return {
    clubName: rows.clubName,
    businessDate: rows.businessDate,
    methods: selectDayPaymentMethods(
      calculateGameClubDayByPaymentMethod(rows.businessDate, rows.cashRows, rows.expenseRows, rows.debtPaymentRows),
      rows.enabledPaymentMethods,
    ),
    barSales: sumBarSales(rows.stockRows),
  };
}

/**
 * The club's most recently closed business day, the one the 08:00 report
 * covers (previousClubBusinessDateIso with the club's start hour), read for
 * that club only.
 */
export async function fetchOwnerBotDay(supabase: SupabaseClient, club: OwnerBotClub, now: Date): Promise<OwnerBotDay> {
  const [startHour, enabledPaymentMethods] = await Promise.all([
    getClubBusinessDayStartHour(supabase, club.id),
    getEnabledPaymentMethods(supabase, club.id),
  ]);
  const businessDate = previousClubBusinessDateIso(now, startHour);
  const onDay = <T,>(table: string, columns: string, orderBy: string[]) => fetchAllRows<T>(() => {
    let query = supabase.from(table).select(columns).eq('club_id', club.id).eq('date', businessDate);
    for (const column of orderBy) query = query.order(column, { ascending: true });
    return query as never;
  });

  const [cash, expenses, debtPayments, stock] = await Promise.all([
    // One entry per club and date (014).
    onDay<DailyCashRow>('daily_cash_entries', 'date,cash_income,terminal_income,card_income,playstation_income', ['date']),
    // The method, source and reserve flag decide which method an expense left (156).
    onDay<ExpenseRow>('expenses', 'id,date,amount,category,payment_method,payment_source,paid_from_reserve,comment,created_at', ['id']),
    onDay<DebtPaymentValueRow & { id: string }>('debt_payments', 'id,date,amount,payment_method', ['id']),
    // (club_id, date, product_id) is unique, so the ordering pages stably.
    onDay<BarSalesRow & { product_id: string }>('daily_stock_counts', 'product_id,date,bar_income', ['product_id']),
  ]);
  const error = [cash.error, expenses.error, debtPayments.error, stock.error].find(Boolean);
  if (error) throw error;

  return summarizeOwnerBotDay({
    clubName: club.name,
    businessDate,
    enabledPaymentMethods,
    cashRows: cash.data ?? [],
    expenseRows: expenses.data ?? [],
    debtPaymentRows: debtPayments.data ?? [],
    stockRows: stock.data ?? [],
  });
}
