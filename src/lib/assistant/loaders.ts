import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '@/types';
import { buildExpensePlanSummary } from '@/lib/calculations/expensePlans';
import { buildMoneyChecks, moneyCheckHistoryStart } from '@/lib/calculations/moneyChecks';
import { buildUpcomingPayments, usualDayHistoryStart } from '@/lib/calculations/upcomingPayments';
import { fetchExpensePresets, fetchPresetExpenses } from '@/lib/supabase/expensePresets';
import { monthRange, previousYearMonth } from '@/lib/utils';
import { buildMonthForecast } from '@/lib/calculations/analysisSeries';
import { reserveBalances, reserveSumsHeld } from '@/lib/calculations/ownerReserve';
import { fetchOwnerMoney, fetchOwnerReserve } from '@/lib/supabase/ownerMoney';
import { sumAvailableMoneyResults } from '@/lib/calculations/availableMoney';
import { canAccessFeature, canAccessPath } from '@/lib/permissions';
import type { StockPurchaseCostRow } from '@/lib/calculations/barMoney';
import type { ExpenseRow } from '@/lib/calculations/dashboardMetrics';
import { buildFinancialAnalysis, buildMonthlyAnalysis, type AnalysisLedgers } from '@/lib/calculations/financialAnalysis';
import {
  buildMoneyReport,
  type MoneyReport,
  type MoneyReportBarSalesRow,
  type MoneyReportCashRow,
  type MoneyReportDebtPaymentRow,
} from '@/lib/calculations/moneyReport';
import { fetchAnalysisLedgers, fetchExpenseLedgerRows } from '@/lib/supabase/analysisLedgers';
import { fetchReserveMoves } from '@/lib/supabase/reserveMoves';
import { loadFinanceReportRows } from '@/lib/supabase/financeReportSnapshot';
import { isMissingDatabaseFunction } from '@/lib/supabase/errors';
import { fetchMoneyExchanges } from '@/lib/supabase/moneyExchanges';
import { fetchAllRows } from '@/lib/supabase/pagination';
import {
  categoriesTable,
  checksTable,
  upcomingTable,
  dailyTable,
  debtsTable,
  expensesTable,
  moneyTable,
  monthlyTable,
  outlookTable,
  type OutlookGap,
  type OutlookPart,
  productSalesTable,
  stockTable,
  summaryTable,
  RANGED_DATASETS,
  type AssistantDataset,
  type DataTable,
  type DebtInputRow,
  type StockInputRow,
} from './datasets';
import { datasetLinks, moneyCheckLinks, outlookLinks, upcomingLinks, type AssistantLink, type LinkAccess } from './links';
import { clampMonths, resolveMonth, resolveRange, trendWindow } from './ranges';

export interface AssistantDataContext {
  /** The member's own server client: RLS authorizes every read. */
  supabase: SupabaseClient;
  clubId: string;
  businessToday: string;
  /** The member's access: record links are offered only for pages they may open. */
  role: UserRole;
  featureAccess: unknown;
}

export interface LoadedDataset {
  table: DataTable;
  period?: { from: string; to: string };
  /** Pages listing the records behind the figures, for the model to link to. */
  links: AssistantLink[];
  /** Parts of the dataset that are left out, and why (only the outlook has any). */
  unavailable?: OutlookGap[];
}

/** A part read before its feature's migration: nothing to show, and not an error. */
const NOT_SET_UP = Symbol('not set up');

export interface DatasetQuery {
  dataset: AssistantDataset;
  from?: string;
  to?: string;
  months?: number;
  category?: string;
  debtStatus?: 'open' | 'paid' | 'all';
}

export class DatasetQueryError extends Error {}

interface MoneyReportRows {
  cash: MoneyReportCashRow[];
  expenses: ExpenseRow[];
  debtPayments: MoneyReportDebtPaymentRow[];
  barSales: MoneyReportBarSalesRow[];
  stockPurchases: StockPurchaseCostRow[];
}

/**
 * The Reports page's money rows: the get_money_report_snapshot RPC, or the
 * same ledgers read directly while migration 047 is not yet applied.
 */
async function fetchMoneyReportRows(
  supabase: SupabaseClient,
  clubId: string,
  range: { from: string; to: string },
): Promise<MoneyReportRows> {
  const snapshot = await supabase.rpc('get_money_report_snapshot', {
    p_club_id: clubId,
    p_range_from: range.from,
    p_range_to: range.to,
  });
  if (!snapshot.error) {
    const data = (snapshot.data ?? {}) as Partial<MoneyReportRows>;
    return {
      cash: data.cash ?? [],
      expenses: data.expenses ?? [],
      debtPayments: data.debtPayments ?? [],
      barSales: data.barSales ?? [],
      stockPurchases: data.stockPurchases ?? [],
    };
  }
  if (!isMissingDatabaseFunction(snapshot.error, 'get_money_report_snapshot')) throw new Error(snapshot.error.message);

  const [cash, expenses, debtPayments, barSales, stockPurchases] = await Promise.all([
    fetchAllRows<MoneyReportCashRow>(() => supabase
      .from('daily_cash_entries')
      .select('id,date,cash_income,terminal_income,card_income,playstation_income')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
    // With the reserve flag, so reserve purchases stay out of the method balances (156).
    fetchExpenseLedgerRows(supabase, clubId, range),
    fetchAllRows<MoneyReportDebtPaymentRow>(() => supabase
      .from('debt_payments')
      .select('id,date,amount,payment_method')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<MoneyReportBarSalesRow>(() => supabase
      .from('daily_stock_counts')
      .select('date,bar_income')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<StockPurchaseCostRow>(() => supabase
      .from('stock_purchases')
      .select('date,quantity,cost_price')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
  ]);
  const failed = [cash, expenses, debtPayments, barSales, stockPurchases].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  return {
    cash: cash.data ?? [],
    expenses: expenses.data ?? [],
    debtPayments: debtPayments.data ?? [],
    barSales: barSales.data ?? [],
    stockPurchases: stockPurchases.data ?? [],
  };
}

/**
 * Reads one dataset for the selected club. Ledgers are cached per range for
 * the lifetime of one assistant request, so a summary and an export of the
 * same period share one database read.
 */
export function createDatasetLoader(context: AssistantDataContext) {
  const ledgerCache = new Map<string, Promise<AnalysisLedgers>>();

  function ledgers(range: { from: string; to: string }) {
    const key = `${range.from}|${range.to}`;
    let promise = ledgerCache.get(key);
    if (!promise) {
      promise = fetchAnalysisLedgers(context.supabase, context.clubId, range);
      ledgerCache.set(key, promise);
    }
    return promise;
  }

  function rangeFor(query: DatasetQuery) {
    const range = resolveRange(query.from, query.to, context.businessToday);
    if ('error' in range) throw new DatasetQueryError(range.error);
    return range;
  }

  const linkAccess: LinkAccess = {
    role: context.role,
    featureAccess: context.featureAccess,
    businessToday: context.businessToday,
  };

  /**
   * A month dataset covers the whole calendar month its period starts in, as
   * Financial Analysis does; its period is reported through the business date.
   */
  function monthFor(query: DatasetQuery) {
    // `to` is ignored: the month is the one `from` falls in, however far back.
    const resolved = resolveMonth(query.from, context.businessToday);
    if ('error' in resolved) throw new DatasetQueryError(resolved.error);
    const month = monthRange(resolved.month);
    return { month, period: { from: month.from, to: month.to < context.businessToday ? month.to : context.businessToday } };
  }

  async function loadChecks(query: DatasetQuery): Promise<LoadedDataset> {
    const { month, period } = monthFor(query);
    // One read covers the month and the history its checks compare with.
    const [rows, plans] = await Promise.all([
      ledgers({ from: moneyCheckHistoryStart(month), to: month.to }),
      // As on Financial Analysis, a failed plan read leaves every category to the checks.
      fetchExpensePresets(context.supabase, context.clubId).catch((error: unknown) => {
        console.error('[assistant] expense plan read failed', { message: error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error) });
        return { presets: [], available: false };
      }),
    ]);
    const checks = buildMoneyChecks({
      range: month,
      today: context.businessToday,
      expenseRows: rows.expenseRows,
      cashRows: rows.cashRows,
      stockRows: rows.stockRows,
      presets: plans.presets,
    });
    return { table: checksTable(checks), period, links: moneyCheckLinks(checks, month.from.slice(0, 7), linkAccess) };
  }

  /**
   * What is still due on the current business month's plans; null without
   * plans. `available` is false where the plans table does not exist yet.
   */
  async function upcomingFor(month: { from: string; to: string }) {
    const [{ presets, available }, linked] = await Promise.all([
      fetchExpensePresets(context.supabase, context.clubId),
      // Far enough back to find each plan's usual pay day.
      fetchPresetExpenses(context.supabase, context.clubId, { from: usualDayHistoryStart(month), to: month.to }),
    ]);
    const upcoming = available && presets.length
      ? buildUpcomingPayments({
        summary: buildExpensePlanSummary(presets, linked, month),
        linkedExpenses: linked,
        range: month,
        today: context.businessToday,
      })
      : null;
    return { upcoming, available };
  }

  async function loadUpcoming(query: DatasetQuery): Promise<LoadedDataset> {
    const { month, period } = monthFor(query);
    // Only the current business month has anything still to pay.
    if (month.from.slice(0, 7) !== context.businessToday.slice(0, 7)) {
      return { table: upcomingTable(null), period, links: upcomingLinks(null, month, linkAccess) };
    }
    const { upcoming } = await upcomingFor(month);
    return { table: upcomingTable(upcoming), period, links: upcomingLinks(upcoming, month, linkAccess) };
  }

  /** The Reports page's money for a range, reserve moves kept out as the page does. */
  async function moneyReportFor(range: { from: string; to: string }): Promise<MoneyReport> {
    const [rows, exchanges, reserveMoves] = await Promise.all([
      fetchMoneyReportRows(context.supabase, context.clubId, range),
      fetchMoneyExchanges(context.supabase, context.clubId, range.from, range.to),
      fetchReserveMoves(context.supabase, context.clubId, range.from, range.to),
    ]);
    return buildMoneyReport(rows.cash, rows.expenses, rows.debtPayments, rows.barSales, rows.stockPurchases, exchanges, reserveMoves);
  }

  /**
   * One part of the outlook: its value, or why it is left out. A member
   * without access is never read for it; a failed read leaves only that part
   * out, and the model is told which reason applies.
   */
  async function outlookPart<T>(
    name: OutlookPart,
    allowed: boolean,
    work: () => Promise<T | typeof NOT_SET_UP>,
  ): Promise<{ value: T } | { gap: OutlookGap }> {
    if (!allowed) return { gap: { part: name, reason: 'no_access' } };
    try {
      const value = await work();
      return value === NOT_SET_UP ? { gap: { part: name, reason: 'not_set_up' } } : { value };
    } catch (error) {
      console.error(`[assistant] outlook ${name} read failed`, { message: error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error) });
      return { gap: { part: name, reason: 'read_failed' } };
    }
  }

  /**
   * The current business month's outlook, whatever period is asked for. Each
   * part follows the access of the page it comes from: the forecast and what
   * is still due need the finance snapshot (as the dataset itself); money left
   * needs reports (as the money dataset); owner withdrawals need Owner Profit
   * (/money-taken, read with fetchOwnerMoney as that page does); the reserve
   * needs an owner who may open /reserve (read as the reserve page does).
   */
  async function loadOutlook(): Promise<LoadedDataset> {
    const yearMonth = context.businessToday.slice(0, 7);
    const month = monthRange(yearMonth);
    const period = { from: month.from, to: context.businessToday };
    const canOpen = (path: string) => canAccessPath(context.role, context.featureAccess, path);
    // Owner Profit's read also carries the reserve ledgers, so the reserve reuses it when it succeeds.
    const ownerMoneyRead = canOpen('/money-taken') ? fetchOwnerMoney(context.supabase, context.clubId, context.businessToday) : null;
    // Its failure is reported by the parts that await it; this only keeps it from going unhandled.
    ownerMoneyRead?.catch(() => {});
    // Only an owner can ever see the reserve: for anyone else it is not a gap worth mentioning.
    const canReadReserve = context.role === 'owner' && canOpen('/reserve');
    const [forecast, plans, money, ownerMonth, reserve] = await Promise.all([
      outlookPart('forecast', true, async () => buildMonthForecast(
        context.businessToday,
        // The forecast compares with last month, so it reads from last month's start.
        await ledgers({ from: monthRange(previousYearMonth(yearMonth)).from, to: context.businessToday }),
      )),
      outlookPart('stillDue', true, async () => {
        const { upcoming, available } = await upcomingFor(month);
        if (!available) return NOT_SET_UP;
        return { gameClub: upcoming?.gameClub.remaining ?? 0, bar: upcoming?.bar.remaining ?? 0 };
      }),
      outlookPart('moneyLeft', canAccessFeature(context.role, context.featureAccess, 'reports'), () => moneyReportFor(period)),
      outlookPart('ownerWithdrawals', ownerMoneyRead !== null, async () => {
        const owner = await ownerMoneyRead!;
        // A month without any owner-money activity has nothing earned or withdrawn yet.
        return owner.balancesByMonth[yearMonth] ?? sumAvailableMoneyResults([]);
      }),
      canReadReserve
        ? outlookPart('reserve', true, async () => {
          const owner = ownerMoneyRead ? await ownerMoneyRead.catch(() => null) : null;
          const data = owner ?? await fetchOwnerReserve(context.supabase, context.clubId, context.businessToday);
          return data.reserveSupported ? reserveSumsHeld(reserveBalances(data.reserveEntries, data.reserveExpenses)) : NOT_SET_UP;
        })
        : null,
    ]);
    const valueOf = <T,>(result: { value: T } | { gap: OutlookGap } | null): T | null => (result && 'value' in result ? result.value : null);
    const table = outlookTable({
      forecast: valueOf(forecast),
      // Calendar days after the business date; it does not depend on any read.
      daysLeft: Number(month.to.slice(8, 10)) - Number(context.businessToday.slice(8, 10)),
      stillDue: valueOf(plans),
      money: valueOf(money),
      ownerMonth: valueOf(ownerMonth),
      reserveSums: valueOf(reserve),
    });
    const unavailable = [forecast, plans, money, ownerMonth, reserve].flatMap((result) => (result && 'gap' in result ? [result.gap] : []));
    return {
      table,
      period,
      links: outlookLinks(period, linkAccess, { ownerProfit: 'value' in ownerMonth, reserve: reserve !== null && 'value' in reserve }),
      unavailable,
    };
  }

  async function load(query: DatasetQuery): Promise<LoadedDataset> {
    if (query.dataset === 'checks') return loadChecks(query);
    if (query.dataset === 'upcoming') return loadUpcoming(query);
    if (query.dataset === 'outlook') return loadOutlook();
    const { table, period } = await loadTable(query);
    return { table, period, links: datasetLinks({ dataset: query.dataset, table, period, category: query.category }, linkAccess) };
  }

  async function loadTable(query: DatasetQuery): Promise<{ table: DataTable; period?: { from: string; to: string } }> {
    const range = RANGED_DATASETS.has(query.dataset) ? rangeFor(query) : undefined;

    switch (query.dataset) {
      case 'summary':
      case 'daily':
      case 'categories':
      case 'expenses': {
        const rows = await ledgers(range!);
        if (query.dataset === 'expenses') return { table: expensesTable(rows.expenseRows, query.category), period: range };
        const analysis = buildFinancialAnalysis(range!, rows);
        if (query.dataset === 'summary') return { table: summaryTable(analysis), period: range };
        if (query.dataset === 'daily') return { table: dailyTable(analysis.daily, rows.cashRows), period: range };
        return { table: categoriesTable(analysis), period: range };
      }
      case 'money':
        return { table: moneyTable(await moneyReportFor(range!)), period: range };
      case 'monthly': {
        const months = clampMonths(query.months);
        const window = trendWindow(context.businessToday, months);
        const rows = await ledgers(window);
        return { table: monthlyTable(buildMonthlyAnalysis(context.businessToday, rows, months), rows.cashRows), period: window };
      }
      case 'product_sales': {
        const result = await loadFinanceReportRows(context.supabase, context.clubId, range!.from, range!.to, 'day');
        if (result.error || !result.data) throw new Error(result.error?.message ?? 'Product sales read failed');
        return { table: productSalesTable(result.data.stockCountRows), period: range };
      }
      case 'stock': {
        const result = await fetchAllRows<StockInputRow>(() => context.supabase
          .from('products')
          .select('name,category,sale_price,current_stock,low_stock_threshold,tracks_inventory,is_active,is_deleted')
          .eq('club_id', context.clubId)
          .order('name', { ascending: true })
          .order('id', { ascending: true }));
        if (result.error) throw new Error(result.error.message);
        return { table: stockTable(result.data ?? []) };
      }
      case 'debts': {
        const status = query.debtStatus ?? 'open';
        const result = await fetchAllRows<DebtInputRow>(() => {
          let request = context.supabase
            .from('new_debts')
            .select('person_name,date,amount,paid_amount,status,comment')
            .eq('club_id', context.clubId);
          if (status === 'open') request = request.neq('status', 'paid');
          if (status === 'paid') request = request.eq('status', 'paid');
          return request.order('date', { ascending: true }).order('id', { ascending: true });
        });
        if (result.error) throw new Error(result.error.message);
        return { table: debtsTable(result.data ?? []) };
      }
      case 'checks':
      case 'upcoming':
      case 'outlook':
        throw new Error(`${query.dataset} is a month dataset`);
    }
  }

  return { load };
}
