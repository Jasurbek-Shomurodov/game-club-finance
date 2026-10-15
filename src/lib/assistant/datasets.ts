import type { UserRole } from '@/types';
import type { ExpenseRow } from '@/lib/calculations/dashboardMetrics';
import type { DailyAnalysisRow, FinancialAnalysis, MonthlyAnalysisRow } from '@/lib/calculations/financialAnalysis';
import type { MoneyReport } from '@/lib/calculations/moneyReport';
import { listLowStockProducts, stockLevel, resolveLowStockThreshold } from '@/lib/calculations/stock';
import { calculateRemainingDebt } from '@/lib/calculations/debt';
import { canAccessFeature, canReadFinancialTotals } from '@/lib/permissions';

/**
 * Datasets the assistant can read and export. Every one is built from the
 * canonical calculations, so the assistant's numbers match the dashboard,
 * financial analysis and reports.
 */
export const ASSISTANT_DATASETS = [
  'summary',
  'money',
  'daily',
  'monthly',
  'categories',
  'expenses',
  'product_sales',
  'stock',
  'debts',
] as const;

export type AssistantDataset = (typeof ASSISTANT_DATASETS)[number];

/** Datasets whose rows depend on a from/to date range. */
export const RANGED_DATASETS: ReadonlySet<AssistantDataset> = new Set([
  'summary', 'money', 'daily', 'categories', 'expenses', 'product_sales',
]);

export type ColumnType = 'text' | 'number' | 'money' | 'date' | 'month' | 'percent';
export type CellValue = string | number | null;

export interface TableColumn {
  /** Translation key under assistant.columns. */
  key: string;
  type: ColumnType;
}

export interface DataTable {
  dataset: AssistantDataset;
  columns: TableColumn[];
  rows: Record<string, CellValue>[];
}

/**
 * Which datasets a member may read. This only shapes the tool list: the
 * member's own Supabase RLS still authorizes every row that is read.
 */
export function allowedDatasets(role: UserRole, featureAccess: unknown): AssistantDataset[] {
  const finance = canReadFinancialTotals(role, featureAccess);
  const can = (key: Parameters<typeof canAccessFeature>[2]) => canAccessFeature(role, featureAccess, key);
  const allowed: Record<AssistantDataset, boolean> = {
    summary: finance,
    money: can('reports'),
    daily: finance,
    monthly: finance,
    categories: finance,
    expenses: finance || can('expenses'),
    product_sales: finance || can('closing_stock'),
    stock: can('inventory') || can('closing_stock') || can('stock_purchase'),
    debts: can('debts'),
  };
  return ASSISTANT_DATASETS.filter((dataset) => allowed[dataset]);
}

const amount = (value: unknown) => Number(value ?? 0) || 0;

export function summaryTable(analysis: FinancialAnalysis): DataTable {
  const { totals, indicators } = analysis;
  const source = (key: FinancialAnalysis['sources'][number]['key']) => (
    analysis.sources.find((row) => row.key === key)?.amount ?? 0
  );
  const metrics: Array<[string, number | null, ColumnType]> = [
    ['income', indicators.income, 'money'],
    ['computers', source('computers'), 'money'],
    ['playstation', source('playstation'), 'money'],
    ['barSales', source('bar'), 'money'],
    ['newDebts', source('debts'), 'money'],
    ['barCost', totals.barCost, 'money'],
    ['debtPayments', totals.debtPaymentsCollected, 'money'],
    ['gameClubExpenses', totals.gameClubExpenses, 'money'],
    ['barExpenses', totals.barExpenses, 'money'],
    ['totalExpenses', totals.totalExpenses, 'money'],
    ['spent', indicators.spent, 'money'],
    ['profit', indicators.left, 'money'],
    ['profitMarginPct', indicators.profitMarginPct, 'percent'],
    ['barMarginPct', indicators.barMarginPct, 'percent'],
    ['salarySharePct', indicators.salarySharePct, 'percent'],
    ['averageDailyIncome', indicators.averageDailyIncome, 'money'],
    ['averageDailySpend', indicators.averageDailySpend, 'money'],
  ];
  return {
    dataset: 'summary',
    columns: [{ key: 'metric', type: 'text' }, { key: 'value', type: 'number' }, { key: 'unit', type: 'text' }],
    rows: metrics.map(([metric, value, type]) => ({ metric, value, unit: type === 'percent' ? '%' : 'UZS' })),
  };
}

/** Game-club payment methods in the order the Reports page shows them. */
const MONEY_METHODS = ['cash', 'terminal', 'card', 'playstation'] as const;

/**
 * The Reports page's money in, expenses and money left: one row per payment
 * method, then game-club, bar and overall totals. Collected money is daily cash
 * entries plus debt payments; bar sales are not part of it and only appear in
 * the bar row's money left.
 */
export function moneyTable(report: MoneyReport): DataTable {
  const methods = MONEY_METHODS.map((method) => ({ line: method, ...report.paymentMethods[method] }));
  const gameClubExpenses = methods.reduce((sum, row) => sum + row.expenses, 0);
  const gameClubLeft = methods.reduce((sum, row) => sum + row.left, 0);
  return {
    dataset: 'money',
    columns: [
      { key: 'line', type: 'text' },
      { key: 'collected', type: 'money' },
      { key: 'expenses', type: 'money' },
      { key: 'left', type: 'money' },
    ],
    rows: [
      ...methods,
      { line: 'gameClub', collected: report.totalCollected, expenses: gameClubExpenses, left: gameClubLeft },
      { line: 'bar', collected: null, expenses: report.totalExpenses - gameClubExpenses, left: report.barLeft },
      { line: 'total', collected: report.totalCollected, expenses: report.totalExpenses, left: report.totalLeft },
    ],
  };
}

export function dailyTable(rows: DailyAnalysisRow[]): DataTable {
  return {
    dataset: 'daily',
    columns: [
      { key: 'date', type: 'date' },
      { key: 'income', type: 'money' },
      { key: 'barCost', type: 'money' },
      { key: 'gameClubExpenses', type: 'money' },
      { key: 'barExpenses', type: 'money' },
      { key: 'spent', type: 'money' },
      { key: 'profit', type: 'money' },
    ],
    rows: rows.map((row) => ({
      date: row.date,
      income: row.income,
      barCost: row.barCost,
      gameClubExpenses: row.gameClubExpenses,
      barExpenses: row.barExpenses,
      spent: row.spent,
      profit: row.income - row.spent,
    })),
  };
}

export function monthlyTable(rows: MonthlyAnalysisRow[]): DataTable {
  return {
    dataset: 'monthly',
    columns: [
      { key: 'month', type: 'month' },
      { key: 'income', type: 'money' },
      { key: 'spent', type: 'money' },
      { key: 'profit', type: 'money' },
    ],
    rows: rows.map((row) => ({ month: row.month.slice(0, 7), income: row.income, spent: row.spent, profit: row.profit })),
  };
}

export function categoriesTable(analysis: FinancialAnalysis): DataTable {
  return {
    dataset: 'categories',
    columns: [
      { key: 'category', type: 'text' },
      { key: 'amount', type: 'money' },
      { key: 'sharePct', type: 'percent' },
      { key: 'count', type: 'number' },
    ],
    rows: analysis.categories.map((row) => ({
      category: row.category,
      amount: row.amount,
      sharePct: row.share,
      count: row.count,
    })),
  };
}

export function expensesTable(rows: ExpenseRow[], category?: string): DataTable {
  return {
    dataset: 'expenses',
    columns: [
      { key: 'date', type: 'date' },
      { key: 'category', type: 'text' },
      { key: 'amount', type: 'money' },
      { key: 'paymentMethod', type: 'text' },
      { key: 'paymentSource', type: 'text' },
      { key: 'comment', type: 'text' },
    ],
    rows: rows
      .filter((row) => !category || row.category === category)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
      .map((row) => ({
        date: row.date,
        category: row.category ?? 'other',
        amount: amount(row.amount),
        paymentMethod: row.payment_method ?? null,
        paymentSource: row.payment_source ?? null,
        comment: row.comment ?? null,
      })),
  };
}

export interface ProductSalesInputRow {
  product_id: string;
  product_name: string | null;
  sold_quantity: number | null;
  bar_income: number | null;
  bar_cost: number | null;
  giveaway_quantity?: number | null;
}

/** Per-product bar sales over the period, best sellers by revenue first. */
export function productSalesTable(rows: ProductSalesInputRow[]): DataTable {
  const byProduct = new Map<string, { product: string; sold: number; giveaway: number; sales: number; cost: number }>();
  for (const row of rows) {
    const current = byProduct.get(row.product_id)
      ?? { product: row.product_name ?? row.product_id, sold: 0, giveaway: 0, sales: 0, cost: 0 };
    current.sold += amount(row.sold_quantity);
    current.giveaway += amount(row.giveaway_quantity);
    current.sales += amount(row.bar_income);
    current.cost += amount(row.bar_cost);
    byProduct.set(row.product_id, current);
  }
  return {
    dataset: 'product_sales',
    columns: [
      { key: 'product', type: 'text' },
      { key: 'soldQuantity', type: 'number' },
      { key: 'giveawayQuantity', type: 'number' },
      { key: 'barSales', type: 'money' },
      { key: 'barCost', type: 'money' },
      { key: 'barProfit', type: 'money' },
    ],
    rows: [...byProduct.values()]
      .sort((a, b) => b.sales - a.sales || b.sold - a.sold || a.product.localeCompare(b.product, 'ru'))
      .map((row) => ({
        product: row.product,
        soldQuantity: row.sold,
        giveawayQuantity: row.giveaway,
        barSales: row.sales,
        barCost: row.cost,
        barProfit: row.sales - row.cost,
      })),
  };
}

export interface StockInputRow {
  name: string;
  category: string | null;
  sale_price: number | null;
  current_stock: number | null;
  low_stock_threshold: number | null;
  tracks_inventory?: boolean | null;
  is_active?: boolean | null;
  is_deleted?: boolean | null;
}

/** Active tracked products with their stock level, lowest stock first. */
export function stockTable(products: StockInputRow[]): DataTable {
  const low = new Set(listLowStockProducts(products).map((product) => product.name));
  return {
    dataset: 'stock',
    columns: [
      { key: 'product', type: 'text' },
      { key: 'category', type: 'text' },
      { key: 'currentStock', type: 'number' },
      { key: 'lowStockThreshold', type: 'number' },
      { key: 'stockLevel', type: 'text' },
      { key: 'salePrice', type: 'money' },
    ],
    rows: products
      .filter((product) => product.is_active !== false && product.is_deleted !== true && product.tracks_inventory !== false)
      .map((product) => {
        const currentStock = amount(product.current_stock);
        const threshold = resolveLowStockThreshold(product.low_stock_threshold);
        return {
          product: product.name,
          category: product.category ?? null,
          currentStock,
          lowStockThreshold: threshold,
          stockLevel: low.has(product.name) ? stockLevel(currentStock, threshold) : 'ok',
          salePrice: amount(product.sale_price),
        };
      })
      .sort((a, b) => a.currentStock - b.currentStock || a.product.localeCompare(b.product, 'ru')),
  };
}

export interface DebtInputRow {
  person_name: string;
  date: string;
  amount: number | null;
  paid_amount: number | null;
  status: string | null;
  comment: string | null;
}

export function debtsTable(rows: DebtInputRow[]): DataTable {
  return {
    dataset: 'debts',
    columns: [
      { key: 'person', type: 'text' },
      { key: 'date', type: 'date' },
      { key: 'amount', type: 'money' },
      { key: 'paidAmount', type: 'money' },
      { key: 'remainingAmount', type: 'money' },
      { key: 'debtStatus', type: 'text' },
      { key: 'comment', type: 'text' },
    ],
    rows: rows.map((row) => ({
      person: row.person_name,
      date: row.date,
      amount: amount(row.amount),
      paidAmount: amount(row.paid_amount),
      remainingAmount: calculateRemainingDebt(amount(row.amount), amount(row.paid_amount)),
      debtStatus: row.status ?? null,
      comment: row.comment ?? null,
    })),
  };
}

/** The model sees at most this many rows per table; Excel exports get every row. */
export const MODEL_ROW_LIMIT = 200;

export function tableForModel(table: DataTable) {
  return {
    dataset: table.dataset,
    columns: table.columns.map((column) => `${column.key}:${column.type}`),
    rowCount: table.rows.length,
    truncated: table.rows.length > MODEL_ROW_LIMIT,
    rows: table.rows.slice(0, MODEL_ROW_LIMIT),
  };
}
