import {
  calculateDashboardTotals,
  getAverageIncomeDayCounts,
  percentChange,
  sumGameClubRows,
  type DailyCashRow,
  type DashboardTotals,
  type DebtPaymentValueRow,
  type DebtValueRow,
  type ExpenseRow,
  type StockCountRow,
  type StockPurchaseCostRow,
} from './dashboardMetrics';

/**
 * Financial analysis: where the selected period's money came from and where it
 * went. The game club and the bar are separate businesses, so their money is
 * never added together; each side has its own totals, derived from
 * calculateDashboardTotals:
 *
 *   game club: in = computers + PlayStation + new debts, spent = expenses paid from game club money
 *   bar:       in = bar sales, spent = bar cost of goods sold + expenses paid from bar money
 *   left      = in - spent, per side
 */

export interface AnalysisLedgers {
  cashRows: DailyCashRow[];
  stockRows: StockCountRow[];
  purchaseRows: StockPurchaseCostRow[];
  expenseRows: ExpenseRow[];
  /** New debts dated inside the period (debt principal counts as income). */
  debtRows: DebtValueRow[];
  debtPaymentRows: DebtPaymentValueRow[];
}

export type IncomeSourceKey = 'computers' | 'playstation' | 'bar' | 'debts' | 'shortfall';
export type SpendingGroupKey = 'barCost' | 'gameClubExpenses' | 'barExpenses';

export const SPENDING_GROUPS: SpendingGroupKey[] = ['barCost', 'gameClubExpenses', 'barExpenses'];

/** Expense categories drawn on their own before the rest fold into "other". */
export const TOP_CATEGORY_COUNT = 7;
export const OTHER_CATEGORY = 'other';
/** Sankey target that is not an expense category. */
export const BAR_COST_TARGET = '__bar_cost';

export interface SankeyNode {
  key: string;
  amount: number;
}

export interface CategoryAmount {
  category: string;
  amount: number;
  share: number;
  count: number;
}

export interface CategoryComparisonRow {
  category: string;
  current: number;
  previous: number;
  change: number;
  /** null when the category had no spending in the previous period. */
  changePct: number | null;
}

export interface DailyAnalysisRow {
  date: string;
  gameClubIncome: number;
  barSales: number;
  barCost: number;
  gameClubExpenses: number;
  barExpenses: number;
}

export interface PaymentMethodFlowRow {
  method: 'cash' | 'terminal' | 'card';
  income: number;
  expenses: number;
  left: number;
}

/** One side of the club; never summed with the other side. */
export interface SourceIndicators {
  income: number;
  spent: number;
  left: number;
  /** left / income, percent with one decimal, null without income. */
  marginPct: number | null;
  averageDailyIncome: number;
}

export interface AnalysisIndicators {
  gameClub: SourceIndicators;
  bar: SourceIndicators;
}

export interface FinancialAnalysis {
  totals: DashboardTotals;
  indicators: AnalysisIndicators;
  sources: Array<{ key: Exclude<IncomeSourceKey, 'shortfall'>; amount: number }>;
  categories: CategoryAmount[];
  /** Top categories plus a folded "other" row, for the donut and comparison. */
  topCategories: CategoryAmount[];
  largest: ExpenseRow[];
  daily: DailyAnalysisRow[];
  paymentMethods: PaymentMethodFlowRow[];
}

const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);
const amountOf = (row: { amount?: number | null }) => Number(row.amount ?? 0);

function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function datesInRange(range: { from: string; to: string }): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  while (cursor <= end && dates.length < 1000) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function analysisTotals(ledgers: AnalysisLedgers): DashboardTotals {
  return calculateDashboardTotals(
    ledgers.cashRows,
    ledgers.stockRows,
    ledgers.purchaseRows,
    ledgers.expenseRows,
    [],
    ledgers.debtRows,
    ledgers.debtPaymentRows,
    [],
  );
}

export function groupExpensesByCategory(expenseRows: ExpenseRow[]): CategoryAmount[] {
  const byCategory = new Map<string, { amount: number; count: number }>();
  for (const row of expenseRows) {
    const category = row.category || OTHER_CATEGORY;
    const entry = byCategory.get(category) ?? { amount: 0, count: 0 };
    entry.amount += amountOf(row);
    entry.count += 1;
    byCategory.set(category, entry);
  }
  const total = sum(expenseRows, amountOf);
  return Array.from(byCategory, ([category, { amount, count }]) => ({
    category,
    amount,
    count,
    share: pct(amount, total) ?? 0,
  }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

/** Keep the largest categories and fold the rest (and any "other") into one row. */
export function foldCategories(categories: CategoryAmount[], limit = TOP_CATEGORY_COUNT): CategoryAmount[] {
  const named = categories.filter((row) => row.category !== OTHER_CATEGORY);
  const top = named.slice(0, limit);
  const rest = [...named.slice(limit), ...categories.filter((row) => row.category === OTHER_CATEGORY)];
  if (rest.length === 0) return top;
  return [
    ...top,
    {
      category: OTHER_CATEGORY,
      amount: sum(rest, (row) => row.amount),
      count: sum(rest, (row) => row.count),
      share: Math.round(sum(rest, (row) => row.share) * 10) / 10,
    },
  ];
}

export function buildCategoryComparison(current: ExpenseRow[], previous: ExpenseRow[]): CategoryComparisonRow[] {
  const currentByCategory = new Map(groupExpensesByCategory(current).map((row) => [row.category, row.amount]));
  const previousByCategory = new Map(groupExpensesByCategory(previous).map((row) => [row.category, row.amount]));
  const categories = new Set([...currentByCategory.keys(), ...previousByCategory.keys()]);
  return Array.from(categories, (category) => {
    const currentAmount = currentByCategory.get(category) ?? 0;
    const previousAmount = previousByCategory.get(category) ?? 0;
    return {
      category,
      current: currentAmount,
      previous: previousAmount,
      change: currentAmount - previousAmount,
      changePct: percentChange(currentAmount, previousAmount),
    };
  }).sort((a, b) => Math.max(b.current, b.previous) - Math.max(a.current, a.previous));
}

/** Income by source; computerIncome includes new debt principal, so it is split back out. */
export function incomeSources(totals: DashboardTotals): FinancialAnalysis['sources'] {
  return [
    { key: 'computers', amount: totals.computerIncome - totals.debtIncome },
    { key: 'playstation', amount: totals.playstationIncome },
    { key: 'bar', amount: totals.barSales },
    { key: 'debts', amount: totals.debtIncome },
  ];
}

export function buildDailyAnalysis(range: { from: string; to: string }, ledgers: AnalysisLedgers): DailyAnalysisRow[] {
  const rows = new Map(datesInRange(range).map((date) => [date, {
    date,
    gameClubIncome: 0,
    barSales: 0,
    barCost: 0,
    gameClubExpenses: 0,
    barExpenses: 0,
  } satisfies DailyAnalysisRow]));
  const at = (date: string) => rows.get(date);

  for (const row of ledgers.cashRows) {
    const day = at(row.date);
    if (day) day.gameClubIncome += sumGameClubRows([row]).gameClubIncome;
  }
  for (const row of ledgers.debtRows) {
    const day = row.date ? at(row.date) : undefined;
    if (day) day.gameClubIncome += amountOf(row);
  }
  for (const row of ledgers.stockRows) {
    const day = at(row.date);
    if (!day) continue;
    day.barSales += Number(row.bar_income ?? 0);
    day.barCost += Number(row.bar_cost ?? 0);
  }
  for (const row of ledgers.expenseRows) {
    const day = at(row.date);
    if (!day) continue;
    if (row.payment_source === 'bar') day.barExpenses += amountOf(row);
    else day.gameClubExpenses += amountOf(row);
  }

  return Array.from(rows.values());
}

/** Game Club money by payment method: collections and debt payments in, game-club-paid expenses out. */
export function buildPaymentMethodFlow(ledgers: AnalysisLedgers): PaymentMethodFlowRow[] {
  const bucket = (method: string | null | undefined): PaymentMethodFlowRow['method'] => (
    method === 'cash' ? 'cash' : method === 'terminal' ? 'terminal' : 'card'
  );
  const flow: Record<PaymentMethodFlowRow['method'], { income: number; expenses: number }> = {
    cash: { income: 0, expenses: 0 },
    terminal: { income: 0, expenses: 0 },
    card: { income: 0, expenses: 0 },
  };
  const collected = sumGameClubRows(ledgers.cashRows);
  flow.cash.income += collected.cashIncome;
  flow.terminal.income += collected.terminalIncome;
  flow.card.income += collected.cardIncome;
  for (const payment of ledgers.debtPaymentRows) flow[bucket(payment.payment_method)].income += amountOf(payment);
  for (const expense of ledgers.expenseRows) {
    if (expense.payment_source === 'bar') continue;
    flow[bucket(expense.payment_method)].expenses += amountOf(expense);
  }
  return (Object.keys(flow) as PaymentMethodFlowRow['method'][]).map((method) => ({
    method,
    ...flow[method],
    left: flow[method].income - flow[method].expenses,
  }));
}

/** Game club money: collections and new debts in, expenses paid from game club money out. */
export function gameClubFlow(totals: DashboardTotals): { income: number; spent: number; left: number } {
  const income = totals.gameClubIncome;
  const spent = totals.gameClubExpenses;
  return { income, spent, left: income - spent };
}

/** Bar money: sales in, cost of goods sold and expenses paid from bar money out. */
export function barFlow(totals: DashboardTotals): { income: number; spent: number; left: number } {
  const income = totals.barSales;
  const spent = totals.barCost + totals.barExpenses;
  return { income, spent, left: income - spent };
}

function sourceIndicators(flow: { income: number; spent: number; left: number }, days: number): SourceIndicators {
  return {
    ...flow,
    marginPct: pct(flow.left, flow.income),
    averageDailyIncome: Math.round(flow.income / days),
  };
}

/** Day counts are per business; see getAverageIncomeDayCounts for the shared definition. */
export function buildAnalysisIndicators(
  totals: DashboardTotals,
  dayCounts: { gameClub: number; bar: number },
): AnalysisIndicators {
  return {
    gameClub: sourceIndicators(gameClubFlow(totals), Math.max(1, dayCounts.gameClub)),
    bar: sourceIndicators(barFlow(totals), Math.max(1, dayCounts.bar)),
  };
}

export function buildFinancialAnalysis(
  range: { from: string; to: string },
  ledgers: AnalysisLedgers,
  options: { largestCount?: number } = {},
): FinancialAnalysis {
  const totals = analysisTotals(ledgers);
  const categories = groupExpensesByCategory(ledgers.expenseRows);
  const topCategories = foldCategories(categories);
  return {
    totals,
    // Same "average daily income" as the dashboard: each side through its latest entry.
    indicators: buildAnalysisIndicators(totals, getAverageIncomeDayCounts(range, ledgers)),
    sources: incomeSources(totals),
    categories,
    topCategories,
    largest: [...ledgers.expenseRows]
      .sort((a, b) => amountOf(b) - amountOf(a) || b.date.localeCompare(a.date))
      .slice(0, options.largestCount ?? 8),
    daily: buildDailyAnalysis(range, ledgers),
    paymentMethods: buildPaymentMethodFlow(ledgers),
  };
}

export interface MonthlyAnalysisRow {
  month: string;
  gameClubIncome: number;
  gameClubLeft: number;
  barSales: number;
  barLeft: number;
}

/** Each side's money in and money left for each of the last `count` calendar months. */
export function buildMonthlyAnalysis(
  businessToday: string,
  ledgers: Omit<AnalysisLedgers, 'purchaseRows' | 'debtPaymentRows'>,
  count = 12,
): MonthlyAnalysisRow[] {
  const [year, month] = businessToday.split('-').map(Number);
  const current = year * 12 + month - 1;
  return Array.from({ length: count }, (_, index) => {
    const absolute = current - count + 1 + index;
    const key = `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}`;
    const inMonth = <T extends { date?: string }>(rows: T[]) => rows.filter((row) => row.date?.startsWith(key));
    const totals = analysisTotals({
      cashRows: inMonth(ledgers.cashRows),
      stockRows: inMonth(ledgers.stockRows),
      purchaseRows: [],
      expenseRows: inMonth(ledgers.expenseRows),
      debtRows: inMonth(ledgers.debtRows),
      debtPaymentRows: [],
    });
    const gameClub = gameClubFlow(totals);
    const bar = barFlow(totals);
    return {
      month: `${key}-01`,
      gameClubIncome: gameClub.income,
      gameClubLeft: gameClub.left,
      barSales: bar.income,
      barLeft: bar.left,
    };
  });
}

export interface CategoryDetail {
  category: string;
  /** Newest first. */
  rows: ExpenseRow[];
  total: number;
  count: number;
  average: number;
  previousTotal: number;
  changePct: number | null;
  /** Share of all expenses in the period, percent. */
  share: number | null;
  gameClubTotal: number;
  barTotal: number;
}

/**
 * Payments behind one slice of the analysis. The folded "other" slice holds
 * every category outside the named top categories, including "other" itself.
 */
export function buildCategoryDetail(
  category: string,
  current: ExpenseRow[],
  previous: ExpenseRow[],
  topCategories: CategoryAmount[],
): CategoryDetail {
  const named = new Set(topCategories.map((row) => row.category).filter((key) => key !== OTHER_CATEGORY));
  const matches = (row: ExpenseRow) => (
    category === OTHER_CATEGORY ? !named.has(row.category || OTHER_CATEGORY) : row.category === category
  );
  const rows = current
    .filter(matches)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const total = sum(rows, amountOf);
  const previousTotal = sum(previous.filter(matches), amountOf);
  const barTotal = sum(rows.filter((row) => row.payment_source === 'bar'), amountOf);
  return {
    category,
    rows,
    total,
    count: rows.length,
    average: rows.length ? Math.round(total / rows.length) : 0,
    previousTotal,
    changePct: percentChange(total, previousTotal),
    share: pct(total, sum(current, amountOf)),
    gameClubTotal: total - barTotal,
    barTotal,
  };
}
