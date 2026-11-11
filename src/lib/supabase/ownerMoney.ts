import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from './pagination';
import { fetchDollarExpenses, fetchMoneyExchanges, type DollarExpense } from './moneyExchanges';
import { isMissingDatabaseColumn, isMissingDatabaseFunction, isMissingDatabaseTable } from './errors';
import { withExchangesByMonth, type MoneyExchangeRow } from '@/lib/calculations/moneyExchanges';
import {
  calculateAvailableMoneyByMonth,
  type AvailableMoneyByMonth,
} from '@/lib/calculations/availableMoney';
import {
  applyOwnerProfitCarryovers,
  buildOwnerProfitSnapshot,
  gameClubMoneyLeftByPaymentMethodByMonth,
  type InvestmentRow,
  type OwnerProfitSnapshotPayload,
} from '@/lib/calculations/ownerProfitSnapshot';
import type { StockPurchaseCostRow } from '@/lib/calculations/barMoney';
import { applyOwnerReserve, type ReservePaidExpense } from '@/lib/calculations/ownerReserve';
import type {
  DailyCashRow,
  DebtPaymentValueRow,
  ExpenseRow,
  MoneyLeftByPaymentMethod,
  StockCountRow,
} from '@/lib/calculations/dashboardMetrics';
import type { OwnerProfitCarryover, OwnerReserveEntry, OwnerWithdrawal, OwnerWithdrawalPaymentMethod } from '@/types';

interface WithdrawalMethodRow {
  id: string;
  payment_method: OwnerWithdrawalPaymentMethod;
}

export interface OwnerMoneyData {
  balancesByMonth: AvailableMoneyByMonth;
  paymentMethodBalancesByMonth: Record<string, MoneyLeftByPaymentMethod>;
  withdrawals: OwnerWithdrawal[];
  carryovers: OwnerProfitCarryover[];
  exchangeRows: MoneyExchangeRow[];
  /** Expenses paid from the club's dollars (124); they lower the dollars held. */
  dollarExpenses: DollarExpense[];
  /** `investments` expenses; empty for a viewer who cannot read expenses. */
  investments: InvestmentRow[];
  /** Migration 071 is applied: unwithdrawn profit can be moved to the next month. */
  carryoversSupported: boolean;
  /** Migration 066 is applied: Game Club withdrawals record a payment method. */
  methodsSupported: boolean;
  /** Owner reserve deposits and returns (136). */
  reserveEntries: OwnerReserveEntry[];
  /** Expenses the reserve paid for (136). */
  reserveExpenses: ReservePaidExpense[];
  /** Migration 136 is applied: profit can be set aside in the reserve. */
  reserveSupported: boolean;
}

export const EMPTY_OWNER_MONEY: OwnerMoneyData = {
  balancesByMonth: {},
  paymentMethodBalancesByMonth: {},
  withdrawals: [],
  carryovers: [],
  exchangeRows: [],
  dollarExpenses: [],
  investments: [],
  carryoversSupported: false,
  methodsSupported: false,
  reserveEntries: [],
  reserveExpenses: [],
  reserveSupported: false,
};

/**
 * Reads every month's owner profit balances, withdrawals and carryovers for one
 * club through `businessToday`. Uses the owner profit snapshot RPC and falls
 * back to the raw ledgers while its migration is being deployed. A superseded
 * load (`isCurrent` false) stops early and returns the empty value.
 */
export async function fetchOwnerMoney(
  supabase: SupabaseClient,
  clubId: string,
  businessToday: string,
  isCurrent: () => boolean = () => true,
): Promise<OwnerMoneyData> {
  const currentMonth = businessToday.slice(0, 7);

  const snapshotArgs = { p_club_id: clubId, p_through_date: businessToday };
  const [snapshotWithMethods, carryoverRes, exchangeRows, investmentRes, dollarExpenses, reserveRes, reserveExpenseRes] = await Promise.all([
    // Migration 076: the snapshot's withdrawal rows carry their payment method.
    supabase.rpc('get_owner_profit_snapshot_with_methods', snapshotArgs),
    fetchAllRows<OwnerProfitCarryover>(() => supabase
      .from('owner_profit_carryovers')
      .select('id,club_id,from_month,to_month,source,payment_method,amount,comment,created_by,created_at')
      .eq('club_id', clubId)
      .lte('from_month', `${currentMonth}-01`)
      .order('id')),
    // Exchanges move money between methods (092); neither balance source includes them.
    fetchMoneyExchanges(supabase, clubId, '2000-01-01', businessToday),
    fetchAllRows<InvestmentRow>(() => supabase
      .from('expenses')
      .select('date,amount,payment_source')
      .eq('club_id', clubId)
      .eq('category', 'investments')
      .lte('date', businessToday)
      .order('id')),
    // Like investments, a failed read leaves dollar spending out instead of failing the page.
    fetchDollarExpenses(supabase, clubId, '2000-01-01', businessToday).catch(() => [] as DollarExpense[]),
    fetchAllRows<OwnerReserveEntry>(() => supabase
      .from('owner_reserve_entries')
      .select('id,club_id,kind,period_month,source,payment_method,amount,comment,created_by,created_at')
      .eq('club_id', clubId)
      .order('id')),
    fetchAllRows<ReservePaidExpense>(() => supabase
      .from('expenses')
      .select('id,date,amount,payment_source,payment_method,category,comment,created_at')
      .eq('club_id', clubId)
      .eq('paid_from_reserve', true)
      .order('id')),
  ]);

  // A superseded load stops early; useClubQuery discards whatever it returns.
  if (!isCurrent()) return EMPTY_OWNER_MONEY;

  // Before migration 076, read the 050 snapshot and the withdrawal methods separately.
  const snapshotHasMethods = !isMissingDatabaseFunction(snapshotWithMethods.error, 'get_owner_profit_snapshot_with_methods');
  const [snapshotResult, methodRes] = snapshotHasMethods
    ? [snapshotWithMethods, null]
    : await Promise.all([
      supabase.rpc('get_owner_profit_snapshot', snapshotArgs),
      fetchAllRows<WithdrawalMethodRow>(() => supabase
        .from('owner_withdrawals')
        .select('id,payment_method')
        .eq('club_id', clubId)
        .not('payment_method', 'is', null)
        .order('id')),
    ]);
  if (!isCurrent()) return EMPTY_OWNER_MONEY;

  // Before migration 071 there is nothing to carry: balances stay per month.
  const carryoversMissing = isMissingDatabaseTable(carryoverRes.error as { code?: string; message?: string } | null, 'owner_profit_carryovers');
  if (carryoverRes.error && !carryoversMissing) throw new Error(carryoverRes.error.message);
  const carryovers = (carryoverRes.data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
  // Before migration 136 there is no reserve: nothing is set aside.
  const reserveMissing = isMissingDatabaseTable(reserveRes.error as { code?: string; message?: string } | null, 'owner_reserve_entries')
    || isMissingDatabaseColumn(reserveExpenseRes.error as { code?: string; message?: string } | null, 'paid_from_reserve');
  const reserveError = reserveMissing ? null : reserveRes.error;
  if (reserveError) throw new Error(reserveError.message);
  const reserveEntries = reserveMissing ? [] : (reserveRes.data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
  // Like investments, a failed expense read leaves reserve purchases out instead of failing the page:
  // their months then show less left to take, never more.
  const reserveExpenses = reserveMissing || reserveExpenseRes.error ? [] : (reserveExpenseRes.data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
  const withCarryovers = (byMonth: AvailableMoneyByMonth) => applyOwnerReserve(
    applyOwnerProfitCarryovers(byMonth, carryovers, currentMonth), reserveEntries, reserveExpenses, currentMonth,
  );

  // Before migration 066 there is no payment_method column: keep every
  // withdrawal unassigned and record new ones by source only.
  const methodsMissing = isMissingDatabaseColumn(methodRes?.error as { code?: string; message?: string } | null, 'payment_method');
  if (methodRes?.error && !methodsMissing) throw new Error(methodRes.error.message);
  const methodById = methodRes
    ? new Map((methodRes.data ?? []).map((row) => [row.id, row.payment_method]))
    : null;
  const withMethods = (rows: OwnerWithdrawal[]) => rows.map((row) => ({
    ...row,
    payment_method: (methodById ? methodById.get(row.id) : row.payment_method) ?? null,
  }));
  // Investments are context for the history, not balances: a failed read hides them instead of the page.
  const investments = investmentRes.error ? [] : (investmentRes.data ?? []);
  const supported = {
    carryoversSupported: !carryoversMissing,
    methodsSupported: !methodsMissing,
    reserveEntries,
    reserveExpenses,
    reserveSupported: !reserveMissing,
  };

  if (!snapshotResult.error && snapshotResult.data?.paymentMethodBalancesByMonth) {
    const snapshot = buildOwnerProfitSnapshot(snapshotResult.data as OwnerProfitSnapshotPayload);
    return {
      balancesByMonth: withCarryovers(snapshot.byMonth),
      paymentMethodBalancesByMonth: withExchangesByMonth(snapshot.paymentMethodBalancesByMonth, exchangeRows),
      withdrawals: withMethods(snapshot.withdrawals),
      carryovers,
      exchangeRows,
      dollarExpenses,
      investments,
      ...supported,
    };
  }

  if (snapshotResult.error && (snapshotHasMethods || !isMissingDatabaseFunction(snapshotResult.error, 'get_owner_profit_snapshot'))) {
    throw new Error(snapshotResult.error.message);
  }

  // Compatibility fallback while the application and migration are deployed separately.
  const [cashRes, stockRes, purchaseRes, expenseRes, debtPaymentRes, withdrawalRes] = await Promise.all([
    fetchAllRows<DailyCashRow>(() => supabase
      .from('daily_cash_entries')
      .select('date,cash_income,terminal_income,card_income,playstation_income')
      .eq('club_id', clubId)
      .lte('date', businessToday)
      .order('id')),
    fetchAllRows<StockCountRow>(() => supabase
      .from('daily_stock_counts')
      .select('date,bar_income,bar_profit,bar_cost,sold_quantity')
      .eq('club_id', clubId)
      .lte('date', businessToday)
      .order('id')),
    fetchAllRows<StockPurchaseCostRow>(() => supabase
      .from('stock_purchases')
      .select('date,quantity,cost_price')
      .eq('club_id', clubId)
      .lte('date', businessToday)
      .order('id')),
    fetchAllRows<ExpenseRow>(() => supabase
      .from('expenses')
      .select('id,date,amount,category,payment_method,payment_source,comment,created_at')
      .eq('club_id', clubId)
      .lte('date', businessToday)
      .order('id')),
    fetchAllRows<DebtPaymentValueRow>(() => supabase
      .from('debt_payments')
      .select('date,amount,payment_method')
      .eq('club_id', clubId)
      .lte('date', businessToday)
      .order('id')),
    fetchAllRows<OwnerWithdrawal>(() => supabase
      .from('owner_withdrawals')
      .select('id,club_id,period_month,source,amount,comment,created_by,created_at,updated_at')
      .eq('club_id', clubId)
      .lte('period_month', `${currentMonth}-01`)
      .order('period_month', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id')),
  ]);
  const firstError = [
    cashRes.error,
    stockRes.error,
    purchaseRes.error,
    expenseRes.error,
    debtPaymentRes.error,
    withdrawalRes.error,
  ].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const withdrawalRows = withdrawalRes.data ?? [];
  const nextLedgerRows = {
    cashRows: cashRes.data ?? [],
    stockRows: stockRes.data ?? [],
    purchaseRows: purchaseRes.data ?? [],
    expenseRows: expenseRes.data ?? [],
    debtPaymentRows: debtPaymentRes.data ?? [],
    withdrawalRows,
  };
  return {
    balancesByMonth: withCarryovers(calculateAvailableMoneyByMonth({
      ...nextLedgerRows,
      throughDate: businessToday,
    })),
    paymentMethodBalancesByMonth: withExchangesByMonth(gameClubMoneyLeftByPaymentMethodByMonth(
      nextLedgerRows.cashRows,
      nextLedgerRows.expenseRows,
      nextLedgerRows.debtPaymentRows,
    ), exchangeRows),
    withdrawals: withMethods(withdrawalRows),
    carryovers,
    exchangeRows,
    dollarExpenses,
    investments,
    ...supported,
  };
}
