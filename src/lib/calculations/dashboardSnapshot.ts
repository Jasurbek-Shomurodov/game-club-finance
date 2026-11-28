import type { Product } from '@/types';
import {
  buildPeriodTrend,
  calculateDashboardInventoryValue,
  calculateDashboardTotals,
  calculateInventoryValueFromLatestStockCounts,
  emptyDashboardTotals,
  getDashboardComparisonRange,
  getDashboardRange,
  getLatestRowDateInRange,
  getSideComparisonRanges,
  type DailyCashRow,
  type DashboardPeriod,
  type DashboardTotals,
  type DebtPaymentValueRow,
  type ExpenseRow,
  type InventorySnapshotRow,
  type ProductValueRow,
  type SideComparisonRanges,
  type StockCountRow,
  type StockPurchaseCostRow,
  type TrendRow,
} from './dashboardMetrics';
import type { AnalysisLedgers } from './financialAnalysis';
import { summarizeDebtors, type DashboardDebtor } from './dashboardAttention';
import { getDebtStatus } from './debt';
import { monthRange, previousYearMonth } from '@/lib/utils';
import type { ReserveMove } from './reserveMoves';

export interface DashboardDebtRow {
  id: string;
  person_name?: string;
  date: string;
  amount: number;
  remaining_amount: number;
  status: string;
}

/** A debt payment dated after a past month, for rebuilding that month's closing debt balances. */
export interface LaterDebtPaymentRow {
  debt_id: string;
  date: string;
  amount: number;
}

/**
 * Debts as they stood at the end of `asOf`: each debt dated on or before it,
 * with its live remaining balance plus the payments dated after it (the
 * payment ledger is append-only and the database keeps `remaining_amount` in
 * step with it), capped at the principal. Debts paid off by then are left out.
 * `debts` may repeat a debt; the first row of each id counts.
 */
export function debtsOpenAsOf<T extends DashboardDebtRow>(
  debts: readonly T[],
  laterPayments: readonly LaterDebtPaymentRow[],
  asOf: string,
): T[] {
  const paidLater = new Map<string, number>();
  for (const payment of laterPayments) {
    if (payment.date <= asOf) continue;
    paidLater.set(payment.debt_id, (paidLater.get(payment.debt_id) ?? 0) + Number(payment.amount ?? 0));
  }
  const seen = new Set<string>();
  const open: T[] = [];
  for (const debt of debts) {
    if (seen.has(debt.id)) continue;
    seen.add(debt.id);
    if (debt.date > asOf) continue;
    const amount = Number(debt.amount ?? 0);
    const liveRemaining = debt.status === 'paid' ? 0 : Number(debt.remaining_amount ?? 0);
    const remaining = Math.max(0, Math.min(amount, liveRemaining + (paidLater.get(debt.id) ?? 0)));
    if (remaining <= 0) continue;
    open.push({ ...debt, remaining_amount: remaining, status: getDebtStatus(amount, amount - remaining) });
  }
  return open;
}

/** A catalog row as the stock value needs it: deactivated and deleted products included. */
export interface InventoryCatalogRow {
  id: string;
  tracks_inventory?: boolean | null;
  deleted_at?: string | null;
}

function dayBefore(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/**
 * Products with no count in the comparison window that may still hold stock
 * value at its end: their latest count is older (a deactivated product is
 * never counted again). Untracked products and ones deleted before the window
 * (stock is zero from the deletion day; the extra day covers the business-day
 * start hour) are left out. The same rule as the Telegram report.
 */
export function productsNeedingEarlierCounts(
  catalog: readonly InventoryCatalogRow[],
  windowRows: ReadonlyArray<{ product_id: string; date: string }>,
  window: { from: string; to: string },
): string[] {
  const covered = new Set(
    windowRows.filter((row) => row.date >= window.from && row.date <= window.to).map((row) => row.product_id),
  );
  const deletedBefore = dayBefore(window.from);
  return catalog
    .filter((product) => product.tracks_inventory !== false
      && !(product.deleted_at && product.deleted_at.slice(0, 10) < deletedBefore)
      && !covered.has(product.id))
    .map((product) => product.id);
}

/** Each product's latest count by date; on a tie the first row seen stays. */
export function latestCountPerProduct(rows: readonly InventorySnapshotRow[]): InventorySnapshotRow[] {
  const latest = new Map<string, InventorySnapshotRow>();
  for (const row of rows) {
    const found = latest.get(row.product_id);
    if (!found || row.date > found.date) latest.set(row.product_id, row);
  }
  return [...latest.values()];
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
  /** Money moved into or out of the owner reserve (156); absent before it, when nothing moves. */
  reserveMoves?: ReserveMove[];
  /**
   * Current month: deactivated (not deleted) products still holding stock.
   * They are off the restock list but their stock is still worth money, as in
   * the count-based month-end value; absent means none.
   */
  inactiveStockProducts?: ProductValueRow[];
  /**
   * The latest count before the comparison window of each product with none
   * inside it, so stock values use every product's latest count however old.
   */
  earlierInventoryRows?: InventorySnapshotRow[];
  /** Past month: debt payments dated after it, to rebuild its closing debt balances. */
  laterDebtPayments?: LaterDebtPaymentRow[];
  /** Past month: debts paid off since, dated on or before its end, that `laterDebtPayments` belong to. */
  laterPaidDebts?: DashboardDebtRow[];
}

/** One side's "vs last month" figures: both periods end on the side's latest entered day (getSideComparisonRanges). */
export interface SideComparisonTotals {
  current: DashboardTotals;
  previous: DashboardTotals;
}

/** A product as the dashboard's restock list reads it; the rest of the row stays on the server. */
export type DashboardStockProduct = Pick<Product, 'id' | 'name' | 'current_stock' | 'tracks_inventory' | 'is_active' | 'is_deleted'>
  & { low_stock_threshold: number | null };

export interface DashboardData {
  totals: DashboardTotals;
  previousTotals: DashboardTotals;
  /** Each side's "vs last month" totals; read only the side's own figures from each. */
  comparison: { gameClub: SideComparisonTotals; bar: SideComparisonTotals };
  inventoryComparisonValue: number;
  hasInventoryComparisonData: boolean;
  trend: TrendRow[];
  lowStockCount: number;
  /** The catalog fields the restock list needs (`buildRestockList`). */
  stockProducts: DashboardStockProduct[];
  /** People with unpaid debts, largest balance first. */
  debtors: DashboardDebtor[];
  /** Dates of the period with a saved daily cash entry. */
  cashEntryDates: string[];
  /** Dates of the period with a saved closing stock count. */
  stockEntryDates: string[];
  expenseCategories: Array<{ category: string; value: number }>;
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
  comparison: {
    gameClub: { current: emptyDashboardTotals, previous: emptyDashboardTotals },
    bar: { current: emptyDashboardTotals, previous: emptyDashboardTotals },
  },
  inventoryComparisonValue: 0,
  hasInventoryComparisonData: false,
  trend: [],
  lowStockCount: 0,
  stockProducts: [],
  debtors: [],
  cashEntryDates: [],
  stockEntryDates: [],
  expenseCategories: [],
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
 *
 * With an earlier `month` (YYYY-MM) the snapshot covers that whole month
 * instead, compared with the whole month before it; its inventory value is
 * the month's last closing stock, not the live stock. A missing, current or
 * future month is the current month.
 */
export function getDashboardSnapshotRanges(businessToday: string, month?: string): DashboardSnapshotRanges {
  if (month && /^\d{4}-\d{2}$/.test(month) && month < businessToday.slice(0, 7)) {
    const range = monthRange(month);
    const previousRange = monthRange(previousYearMonth(month));
    return { period: 'lastMonth', range, previousRange, inventoryComparisonRange: previousRange };
  }
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

/**
 * The dashboard's figures from one snapshot payload. `businessToday` lets a
 * month in progress compare each side through its latest entered day; without
 * it each side compares `range` with `previousRange`. `businessDayStartHour`
 * dates product deletions in the club's business days.
 */
export function buildDashboardDataFromSnapshot({
  period,
  range,
  previousRange,
  inventoryComparisonRange,
  payload,
  businessToday,
  businessDayStartHour = 0,
}: {
  period: DashboardPeriod;
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  inventoryComparisonRange: { from: string; to: string };
  payload: DashboardSnapshotPayload;
  businessToday?: string;
  businessDayStartHour?: number;
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
  // A past month shows the debts open at its end, not today's.
  const activeDebts = period === 'lastMonth'
    ? debtsOpenAsOf([...payload.debtRows, ...(payload.laterPaidDebts ?? [])], payload.laterDebtPayments ?? [], range.to)
    : payload.debtRows.filter((debt) => debt.status !== 'paid');
  const inventoryComparisonRows = rowsInRange(payload.inventoryRows, inventoryComparisonRange);
  // Every count the values may need: the snapshot's windows plus older latest counts.
  const inventoryRows = [...payload.inventoryRows, ...(payload.earlierInventoryRows ?? [])];

  const liveTotals = calculateDashboardTotals(
    cashRows,
    stockRows,
    purchaseRows,
    expenseRows,
    // Stock value counts deactivated products too; the restock list below does not.
    [...payload.products, ...(payload.inactiveStockProducts ?? [])],
    rangeDebts,
    debtPaymentRows,
    activeDebts,
    rowsInRange(payload.reserveMoves ?? [], range),
  );
  const totals = {
    ...liveTotals,
    inventoryValue: calculateDashboardInventoryValue(
      period,
      liveTotals.inventoryValue,
      inventoryRows,
      range,
      businessDayStartHour,
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
    rowsInRange(payload.reserveMoves ?? [], previousRange),
  );
  // "vs last month" per side; the payload's comparison period already covers both stretches.
  const totalsFor = (stretch: { from: string; to: string }) => calculateDashboardTotals(
    rowsInRange(payload.cashRows, stretch),
    rowsInRange(payload.stockRows, stretch),
    rowsInRange(payload.purchaseRows, stretch),
    rowsInRange(payload.expenseRows, stretch),
    [],
    rowsInRange(payload.debtRows, stretch),
    rowsInRange(payload.debtPaymentRows, stretch),
    [],
    rowsInRange(payload.reserveMoves ?? [], stretch),
  );
  const sideTotals = (side: SideComparisonRanges): SideComparisonTotals => ({
    current: totalsFor(side.current),
    previous: totalsFor(side.previous),
  });
  const sideRanges = businessToday
    ? getSideComparisonRanges(period, range, businessToday, { cashRows, debtRows: rangeDebts, stockRows })
    : null;
  const comparison = sideRanges
    ? { gameClub: sideTotals(sideRanges.gameClub), bar: sideTotals(sideRanges.bar) }
    : {
      gameClub: { current: liveTotals, previous: previousTotals },
      bar: { current: liveTotals, previous: previousTotals },
    };
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
    comparison,
    // Each product's latest count on or before last month's end, however old (as the Telegram report).
    inventoryComparisonValue: calculateInventoryValueFromLatestStockCounts(
      inventoryRows.filter((row) => row.date <= inventoryComparisonRange.to),
      inventoryComparisonRange.to,
      businessDayStartHour,
    ),
    hasInventoryComparisonData: inventoryComparisonRows.length > 0,
    trend: buildPeriodTrend(range, cashRows, stockRows, rangeDebts),
    lowStockCount: payload.products.filter(
      (product) => product.tracks_inventory !== false
        && product.current_stock <= (product.low_stock_threshold ?? 5),
    ).length,
    stockProducts: payload.products.map((product) => ({
      id: product.id,
      name: product.name,
      current_stock: product.current_stock,
      low_stock_threshold: product.low_stock_threshold ?? null,
      tracks_inventory: product.tracks_inventory,
      is_active: product.is_active,
      is_deleted: product.is_deleted,
    })),
    debtors: summarizeDebtors(activeDebts),
    cashEntryDates: [...new Set(cashRows.map((row) => row.date))].sort(),
    stockEntryDates: [...new Set(stockRows.map((row) => row.date))].sort(),
    expenseCategories,
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
