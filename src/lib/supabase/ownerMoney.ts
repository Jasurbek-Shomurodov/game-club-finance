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
import { applyOwnerReserve, dollarReserveEntries, type ReserveLedgerEntry, type ReservePaidExpense } from '@/lib/calculations/ownerReserve';
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
  /** Owner reserve deposits and returns (136), and the dollar exchanges that stand for them (143). */
  reserveEntries: ReserveLedgerEntry[];
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

/** The reserve fields of `OwnerMoneyData`: all the Reserve page shows. */
export type OwnerReserveData = Pick<OwnerMoneyData, 'reserveEntries' | 'reserveExpenses' | 'exchangeRows' | 'dollarExpenses' | 'reserveSupported'>;

export const EMPTY_OWNER_RESERVE: OwnerReserveData = {
  reserveEntries: [],
  reserveExpenses: [],
  exchangeRows: [],
  dollarExpenses: [],
  reserveSupported: false,
};

/** The four reads behind the reserve, started together. A failed exchange read rejects. */
function readReserveLedgers(supabase: SupabaseClient, clubId: string, businessToday: string) {
  return Promise.all([
    // Exchanges move money between methods (092); neither balance source includes them.
    fetchMoneyExchanges(supabase, clubId, '2000-01-01', businessToday),
    // Like investments, a failed read leaves dollar spending out instead of failing the page.
    fetchDollarExpenses(supabase, clubId, '2000-01-01', businessToday).catch(() => [] as DollarExpense[]),
    // Every column, so entry_date (162) comes back where the database has it and is simply absent before.
    fetchAllRows<OwnerReserveEntry>(() => supabase
      .from('owner_reserve_entries')
      .select('*')
      .eq('club_id', clubId)
      .order('id')),
    // Dollar expenses are reserve purchases too: the reserve holds the club's dollars (143).
    fetchAllRows<ReservePaidExpense>(() => supabase
      .from('expenses')
      .select('id,date,amount,payment_source,payment_method,category,comment,created_at')
      .eq('club_id', clubId)
      .or('paid_from_reserve.eq.true,payment_method.eq.usd')
      .order('id')),
  ]);
}

/** Turns the raw reserve reads into the reserve's entries and purchases. Throws a failed entries read. */
function buildOwnerReserve(
  clubId: string,
  [exchangeRows, dollarExpenses, reserveRes, reserveExpenseRes]: Awaited<ReturnType<typeof readReserveLedgers>>,
): OwnerReserveData {
  // Before migration 136 there is no reserve: nothing is set aside.
  const reserveMissing = isMissingDatabaseTable(reserveRes.error as { code?: string; message?: string } | null, 'owner_reserve_entries')
    || isMissingDatabaseColumn(reserveExpenseRes.error as { code?: string; message?: string } | null, 'paid_from_reserve');
  const reserveError = reserveMissing ? null : reserveRes.error;
  if (reserveError) throw new Error(reserveError.message);
  return {
    // Exchanges into and out of dollars are the reserve's dollar deposits and returns (143).
    reserveEntries: reserveMissing ? [] : [
      ...(reserveRes.data ?? []).map((row) => ({ ...row, amount: Number(row.amount) })),
      ...dollarReserveEntries(exchangeRows, clubId),
    ],
    // Like investments, a failed expense read leaves reserve purchases out instead of failing the page:
    // their months then show less left to take, never more.
    reserveExpenses: reserveMissing || reserveExpenseRes.error ? [] : (reserveExpenseRes.data ?? []).map((row) => ({ ...row, amount: Number(row.amount) })),
    exchangeRows,
    dollarExpenses,
    reserveSupported: !reserveMissing,
  };
}

/**
 * The owner reserve alone: its deposits, returns, purchases and dollars. The
 * Reserve page needs none of the monthly profit balances, so this skips the
 * owner profit snapshot (the heaviest read of `fetchOwnerMoney`), the
 * carryovers and the investments. A superseded load returns the empty value.
 */
export async function fetchOwnerReserve(
  supabase: SupabaseClient,
  clubId: string,
  businessToday: string,
  isCurrent: () => boolean = () => true,
): Promise<OwnerReserveData> {
  const ledgers = await readReserveLedgers(supabase, clubId, businessToday);
  if (!isCurrent()) return EMPTY_OWNER_RESERVE;
  return buildOwnerReserve(clubId, ledgers);
}

type RowsResult<T> = { data: T[] | null; error: { code?: string; message: string } | null };
type SnapshotResult = { data: unknown; error: { code?: string; message: string } | null };
type OwnerMoneyReads = [
  SnapshotResult,
  RowsResult<OwnerProfitCarryover>,
  RowsResult<InvestmentRow>,
  Awaited<ReturnType<typeof readReserveLedgers>>,
];

interface OwnerMoneyBundle {
  snapshot: unknown;
  carryovers: OwnerProfitCarryover[];
  investments: InvestmentRow[];
  exchanges: MoneyExchangeRow[];
  dollarExpenses: DollarExpense[];
  reserveEntries: OwnerReserveEntry[];
  reserveExpenses: ReservePaidExpense[];
}

/**
 * The owner money reads as one `get_owner_money_bundle` call (migration 150),
 * shaped like the separate reads it replaces. Null when the bundle is not
 * usable, whatever the reason: the caller then makes the separate reads.
 */
async function readOwnerMoneyBundle(
  supabase: SupabaseClient,
  args: { p_club_id: string; p_through_date: string },
): Promise<OwnerMoneyReads | null> {
  const { data, error } = await supabase.rpc('get_owner_money_bundle', args);
  const bundle = data as Partial<OwnerMoneyBundle> | null;
  if (error || !bundle || typeof bundle !== 'object' || !bundle.snapshot) return null;
  const rows = <T,>(value: T[] | undefined): RowsResult<T> => ({ data: value ?? [], error: null });
  return [
    { data: bundle.snapshot, error: null },
    rows(bundle.carryovers),
    rows(bundle.investments),
    [bundle.exchanges ?? [], bundle.dollarExpenses ?? [], rows(bundle.reserveEntries), rows(bundle.reserveExpenses)] as OwnerMoneyReads[3],
  ];
}

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
  // Migration 150: everything below in one request. Any failure of the bundle
  // (not deployed yet, or one of its reads refused) falls back to the separate
  // reads, which decide for themselves what the page can do without.
  const bundle = await readOwnerMoneyBundle(supabase, snapshotArgs);
  if (!isCurrent()) return EMPTY_OWNER_MONEY;
  const [snapshotWithMethods, carryoverRes, investmentRes, reserveLedgers] = bundle ?? await Promise.all([
    // Migration 076: the snapshot's withdrawal rows carry their payment method.
    supabase.rpc('get_owner_profit_snapshot_with_methods', snapshotArgs),
    fetchAllRows<OwnerProfitCarryover>(() => supabase
      .from('owner_profit_carryovers')
      .select('id,club_id,from_month,to_month,source,payment_method,amount,comment,created_by,created_at')
      .eq('club_id', clubId)
      .lte('from_month', `${currentMonth}-01`)
      .order('id')),
    fetchAllRows<InvestmentRow>(() => supabase
      .from('expenses')
      .select('date,amount,payment_source')
      .eq('club_id', clubId)
      .eq('category', 'investments')
      .lte('date', businessToday)
      .order('id')),
    readReserveLedgers(supabase, clubId, businessToday),
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
  const { reserveEntries, reserveExpenses, exchangeRows, dollarExpenses, reserveSupported } = buildOwnerReserve(clubId, reserveLedgers);
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
    reserveSupported,
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
