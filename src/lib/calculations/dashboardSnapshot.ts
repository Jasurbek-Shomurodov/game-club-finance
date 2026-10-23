import type { Product } from '@/types';
import {
  buildPeriodTrend,
  calculateDashboardInventoryValue,
  calculateDashboardTotals,
  calculateGameClubMoneyLeftByPaymentMethod,
  calculateInventoryValueFromLatestStockCounts,
  emptyDashboardTotals,
  emptyMoneyLeftByPaymentMethod,
  getDashboardComparisonRange,
  getDashboardRange,
  getLatestRowDateInRange,
  type DailyCashRow,
  type DashboardPeriod,
  type DashboardTotals,
  type DebtPaymentValueRow,
  type ExpenseRow,
  type InventorySnapshotRow,
  type MoneyLeftByPaymentMethod,
  type StockCountRow,
  type StockPurchaseCostRow,
  type TrendRow,
} from './dashboardMetrics';
import type { AnalysisLedgers } from './financialAnalysis';

export interface DashboardDebtRow {
  id: string;
  person_name?: string;
  date: string;
  amount: number;
  remaining_amount: number;
  status: string;
}

export interface DashboardStockPurchaseRow extends StockPurchaseCostRow {
  id: string;
  comment?: string | null;
  created_at?: string;
}

export interface DashboardSnapshotPayload {
  cashRows: DailyCashRow[];
  stockRows: StockCountRow[];
  inventoryRows: InventorySnapshotRow[];
  purchaseRows: DashboardStockPurchaseRow[];
  expenseRows: ExpenseRow[];
  debtRows: DashboardDebtRow[];
  debtPaymentRows: DebtPaymentValueRow[];
  products: Product[];
}

export interface DashboardData {
  totals: DashboardTotals;
  previousTotals: DashboardTotals;
  inventoryComparisonValue: number;
  hasInventoryComparisonData: boolean;
  trend: TrendRow[];
  lowStockCount: number;
  expenseCategories: Array<{ category: string; value: number }>;
  moneyLeftByPaymentMethod: MoneyLeftByPaymentMethod;
  latestDailyCashEntryDate: string | null;
  latestBarEntryDate: string | null;
  /** The period's ledgers behind the money-flow Sankeys, from the same snapshot as the cards. */
  ledgers: AnalysisLedgers;
}

export const emptyDashboardLedgers: AnalysisLedgers = {
  cashRows: [],
  stockRows: [],
  purchaseRows: [],
  expenseRows: [],
  debtRows: [],
  debtPaymentRows: [],
};

export const emptyDashboardData: DashboardData = {
  totals: emptyDashboardTotals,
  previousTotals: emptyDashboardTotals,
  inventoryComparisonValue: 0,
  hasInventoryComparisonData: false,
  trend: [],
  lowStockCount: 0,
  expenseCategories: [],
  moneyLeftByPaymentMethod: emptyMoneyLeftByPaymentMethod,
  latestDailyCashEntryDate: null,
  latestBarEntryDate: null,
  ledgers: emptyDashboardLedgers,
};

type DateRange = { from: string; to: string };

export interface DashboardSnapshotRanges {
  period: DashboardPeriod;
  range: DateRange;
  previousRange: DateRange;
  inventoryComparisonRange: DateRange;
}

/**
 * The ranges one dashboard snapshot covers: the club's current business
 * month, the same elapsed days of the previous month, and last month's
 * closing stock for the inventory comparison.
 */
export function getDashboardSnapshotRanges(businessToday: string): DashboardSnapshotRanges {
  const period = 'month' as const;
  const range = getDashboardRange(period, businessToday);
  return {
    period,
    range,
    previousRange: getDashboardComparisonRange(period, range, businessToday),
    inventoryComparisonRange: getDashboardRange('lastMonth', businessToday),
  };
}

function rowsInRange<T extends { date: string }>(rows: T[], range: { from: string; to: string }): T[] {
  return rows.filter((row) => row.date >= range.from && row.date <= range.to);
}

/** Per-day bar totals: the RPC already sends these; the table fallback sends one row per product. */
function dailyStockTotals(rows: StockCountRow[]): StockCountRow[] {
  const byDate = new Map<string, StockCountRow>();
  for (const row of rows) {
    const total = byDate.get(row.date) ?? { date: row.date, bar_income: 0, bar_cost: 0, bar_profit: 0, sold_quantity: 0 };
    total.bar_income += Number(row.bar_income ?? 0);
    total.bar_cost += Number(row.bar_cost ?? 0);
    total.bar_profit += Number(row.bar_profit ?? 0);
    total.sold_quantity += Number(row.sold_quantity ?? 0);
    byDate.set(row.date, total);
  }
  return [...byDate.values()];
}

export function buildDashboardDataFromSnapshot({
  period,
  range,
  previousRange,
  inventoryComparisonRange,
  payload,
}: {
  period: DashboardPeriod;
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  inventoryComparisonRange: { from: string; to: string };
  payload: DashboardSnapshotPayload;
}): DashboardData {
  const cashRows = rowsInRange(payload.cashRows, range);
  const previousCashRows = rowsInRange(payload.cashRows, previousRange);
  const stockRows = rowsInRange(payload.stockRows, range);
  const previousStockRows = rowsInRange(payload.stockRows, previousRange);
  const purchaseRows = rowsInRange(payload.purchaseRows, range);
  const previousPurchaseRows = rowsInRange(payload.purchaseRows, previousRange);
  const expenseRows = rowsInRange(payload.expenseRows, range);
  const previousExpenseRows = rowsInRange(payload.expenseRows, previousRange);
  const debtPaymentRows = rowsInRange(payload.debtPaymentRows, range);
  const previousDebtPaymentRows = rowsInRange(payload.debtPaymentRows, previousRange);
  const rangeDebts = rowsInRange(payload.debtRows, range);
  const previousDebts = rowsInRange(payload.debtRows, previousRange);
  const activeDebts = payload.debtRows.filter((debt) => debt.status !== 'paid');
  const inventoryComparisonRows = rowsInRange(payload.inventoryRows, inventoryComparisonRange);

  const liveTotals = calculateDashboardTotals(
    cashRows,
    stockRows,
    purchaseRows,
    expenseRows,
    payload.products,
    rangeDebts,
    debtPaymentRows,
    activeDebts,
  );
  const totals = {
    ...liveTotals,
    inventoryValue: calculateDashboardInventoryValue(
      period,
      liveTotals.inventoryValue,
      payload.inventoryRows,
      range,
    ),
  };
  const previousTotals = calculateDashboardTotals(
    previousCashRows,
    previousStockRows,
    previousPurchaseRows,
    previousExpenseRows,
    payload.products,
    previousDebts,
    previousDebtPaymentRows,
    activeDebts,
  );
  const expenseCategories = Array.from(
    expenseRows.reduce((categoryMap, row) => {
      categoryMap.set(row.category, (categoryMap.get(row.category) ?? 0) + Number(row.amount ?? 0));
      return categoryMap;
    }, new Map<string, number>()),
    ([category, value]) => ({ category, value }),
  ).sort((a, b) => b.value - a.value);

  return {
    totals,
    previousTotals,
    inventoryComparisonValue: calculateInventoryValueFromLatestStockCounts(inventoryComparisonRows),
    hasInventoryComparisonData: inventoryComparisonRows.length > 0,
    trend: buildPeriodTrend(range, cashRows, stockRows, rangeDebts),
    lowStockCount: payload.products.filter(
      (product) => product.tracks_inventory !== false
        && product.current_stock <= (product.low_stock_threshold ?? 5),
    ).length,
    expenseCategories,
    moneyLeftByPaymentMethod: calculateGameClubMoneyLeftByPaymentMethod(
      cashRows,
      expenseRows,
      debtPaymentRows,
    ),
    latestDailyCashEntryDate: getLatestRowDateInRange([...cashRows, ...rangeDebts], range),
    latestBarEntryDate: getLatestRowDateInRange(stockRows, range),
    // Sankeys use only sales and cost of goods sold; purchases are not part of the flows.
    ledgers: {
      cashRows,
      stockRows: dailyStockTotals(stockRows),
      purchaseRows: [],
      expenseRows,
      debtRows: rangeDebts,
      debtPaymentRows,
    },
  };
}
