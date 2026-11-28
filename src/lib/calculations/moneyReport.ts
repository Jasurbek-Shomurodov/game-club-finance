import {
  calculateGameClubMoneyLeftByPaymentMethod,
  gameClubExpensePaymentBucket,
  isDollarExpense,
  isBarPaidExpense,
  type DailyCashRow,
  type DebtPaymentValueRow,
  type ExpenseRow,
  type MoneyLeftByPaymentMethod,
} from './dashboardMetrics';
import { exchangeFlowByMethod, heldDollars, type DollarExpenseRow, type ExchangeMethod, type MoneyExchangeRow } from './moneyExchanges';
import { isReservePaidExpense, reservedNetBy, type ReserveMove } from './reserveMoves';
import {
  calculateBarMoney,
  type BarSalesRow,
  type StockPurchaseCostRow,
} from './barMoney';

export interface MoneyReportPaymentBreakdown {
  /**
   * Money left in the method from earlier days of the period's first month,
   * before the period starts; already included in `left`. 0 unless set by
   * `withOpeningBalances`.
   */
  opening: number;
  collected: number;
  expenses: number;
  /** Net money moved in (+) or out (-) by exchanges; PlayStation is never exchanged. */
  exchanged: number;
  /** Money this method received from exchanges, as a positive amount. */
  exchangedIn: number;
  /** Money this method gave to exchanges, as a positive amount. */
  exchangedOut: number;
  /** Net money put into the owner reserve from this method (156); already taken out of `left`. */
  reserved?: number;
  left: number;
}

export interface MoneyReportActivity {
  id: string | null;
  source: 'daily_cash' | 'debt_payment' | 'expense' | 'exchange';
  kind: 'income' | 'debt_payment' | 'expense' | 'exchange';
  category: string | null;
  /** Positive values are collections; negative values are deductions. */
  amount: number;
  paymentMethod: string | null;
  paymentSource?: 'game_club' | 'bar' | null;
  comment: string | null;
  createdAt: string | null;
  createdByName?: string | null;
  paymentBreakdown?: {
    cash: number;
    terminal: number;
    card: number;
    playstation: number;
  };
  /** Only on expenses paid from the club's dollars (124): dollars spent and the rate they were booked at. */
  dollars?: { amount: number; rate: number };
  /** Only on exchanges, whose `amount` is 0: they move money rather than add or remove it. */
  exchange?: {
    from: ExchangeMethod;
    to: ExchangeMethod;
    fromAmount: number;
    toAmount: number;
    rate: number | null;
  };
}

export interface MoneyReportDay {
  date: string;
  cash: number;
  terminal: number;
  card: number;
  playstation: number;
  /**
   * Game-club money left for the day: income minus the expenses Game Club money
   * paid (a purchase the reserve paid is not one), minus dollars bought, which
   * go into the reserve. Deposits and returns are made per month, so they show
   * on the period's method cards, not on a day. UZS exchanges do not change it.
   */
  total: number;
  income: number;
  /** Every expense recorded on the day, whichever money paid it. */
  expenses: number;
  /** Expenses paid from game-club money (not the Bar or the reserve); the only ones deducted from `total`. */
  gameClubExpenses: number;
  /** Expenses paid from bar money; they reduce bar cash, not `total`. */
  barExpenses: number;
  activities: MoneyReportActivity[];
}

/** Game-club and bar money are separate businesses and are never added together. */
export interface MoneyReport {
  totalCollected: number;
  /** Expenses paid from game-club money; a purchase the reserve paid is not one (156). */
  gameClubExpenses: number;
  /** Expenses paid from bar money. */
  barExpenses: number;
  /**
   * Game-club money collected minus the expenses it paid, minus what it put into
   * the owner reserve (156). The reserve is the owner's own money: dollars bought
   * go into it, and a purchase it paid takes nothing from Game Club. Exchanges
   * between UZS methods never change it. Matches the dashboard headline.
   */
  gameClubLeft: number;
  barLeft: number;
  paymentMethods: Record<keyof MoneyLeftByPaymentMethod, MoneyReportPaymentBreakdown>;
  /** Dollars bought minus dollars sold and spent in the period; never added to UZS figures. */
  usd: number;
  days: MoneyReportDay[];
}

export interface MoneyReportCashRow extends DailyCashRow {
  id?: string;
  comment?: string | null;
}

export interface MoneyReportDebtPaymentRow extends DebtPaymentValueRow {
  id?: string;
  comment?: string | null;
  created_at?: string;
}

export interface MoneyReportBarSalesRow extends BarSalesRow {
  date: string;
}

export type MoneyReportCategoryFilter =
  | 'all'
  /** Everything the game club took in: daily income and debt payments (the "total collected" figure). */
  | 'money_in'
  | 'income'
  | 'debt_payment'
  | 'expense'
  | 'exchange'
  | `expense:${string}`;

function buildPaymentMethods(
  cashRows: DailyCashRow[],
  expenseRows: ExpenseRow[],
  debtPaymentRows: DebtPaymentValueRow[],
  exchangeRows: MoneyExchangeRow[] = [],
  reserveMoves: readonly ReserveMove[] = [],
): MoneyReport['paymentMethods'] {
  const collected = cashRows.reduce(
    (totals, row) => {
      totals.cash += Number(row.cash_income ?? 0);
      totals.terminal += Number(row.terminal_income ?? 0);
      totals.card += Number(row.card_income ?? 0);
      totals.playstation += Number(row.playstation_income ?? 0);
      return totals;
    },
    { cash: 0, terminal: 0, card: 0, playstation: 0 },
  );

  debtPaymentRows.forEach((row) => {
    collected[gameClubExpensePaymentBucket(row.payment_method)] += Number(row.amount ?? 0);
  });

  const expenses = expenseRows.reduce(
    (totals, row) => {
      // The reserve paid its purchases, not a method (156).
      if (row.payment_source !== 'bar' && !isReservePaidExpense(row)) {
        totals[gameClubExpensePaymentBucket(row.payment_method)] += Number(row.amount ?? 0);
      }
      return totals;
    },
    { cash: 0, terminal: 0, card: 0, playstation: 0 },
  );

  const left = calculateGameClubMoneyLeftByPaymentMethod(cashRows, expenseRows, debtPaymentRows, exchangeRows, reserveMoves);
  // Only set when money moved, so methods without reserve activity read as before.
  const reservedField = (key: keyof MoneyLeftByPaymentMethod) => {
    const reserved = reservedNetBy(reserveMoves, 'game_club', key);
    return reserved === 0 ? {} : { reserved };
  };
  const flow = exchangeFlowByMethod(exchangeRows);
  const method = (key: 'cash' | 'terminal' | 'card'): MoneyReportPaymentBreakdown => ({
    opening: 0,
    collected: collected[key],
    expenses: expenses[key],
    exchanged: flow[key].in - flow[key].out,
    exchangedIn: flow[key].in,
    exchangedOut: flow[key].out,
    ...reservedField(key),
    left: left[key],
  });

  return {
    cash: method('cash'),
    terminal: method('terminal'),
    card: method('card'),
    playstation: {
      opening: 0,
      collected: collected.playstation,
      expenses: expenses.playstation,
      exchanged: 0,
      exchangedIn: 0,
      exchangedOut: 0,
      ...reservedField('playstation'),
      left: left.playstation,
    },
  };
}

/**
 * Expenses Game Club money paid: neither the Bar nor the owner reserve (156).
 * It is what the method cards deduct, so collected minus it is `gameClubLeft`
 * when nothing went into the reserve.
 */
function sumGameClubPaidExpenses(rows: readonly ExpenseRow[]): number {
  return rows.reduce(
    (sum, row) => (row.payment_source === 'bar' || isReservePaidExpense(row) ? sum : sum + Number(row.amount ?? 0)),
    0,
  );
}

/**
 * Sum of the methods' money left. UZS moved between methods nets to zero;
 * UZS sent into dollars went into the owner reserve (143, 156), so it left
 * Game Club money, and dollars sold come back into it.
 */
function gameClubLeftOf(methods: MoneyReport['paymentMethods']): number {
  return Object.values(methods).reduce((sum, method) => sum + method.left, 0);
}

function buildDailyActivities(
  cashRows: MoneyReportCashRow[],
  expenseRows: ExpenseRow[],
  debtPaymentRows: MoneyReportDebtPaymentRow[],
  exchangeRows: MoneyExchangeRow[] = [],
): MoneyReportActivity[] {
  const activities: MoneyReportActivity[] = [];

  cashRows.forEach((row) => {
    const paymentBreakdown = {
      cash: Number(row.cash_income ?? 0),
      terminal: Number(row.terminal_income ?? 0),
      card: Number(row.card_income ?? 0),
      playstation: Number(row.playstation_income ?? 0),
    };
    activities.push({
      id: row.id ?? null,
      source: 'daily_cash',
      kind: 'income',
      category: null,
      amount: Object.values(paymentBreakdown).reduce((sum, amount) => sum + amount, 0),
      paymentMethod: null,
      comment: row.comment ?? null,
      createdAt: row.created_at ?? null,
      ...(row.creator_name !== undefined ? { createdByName: row.creator_name } : {}),
      paymentBreakdown,
    });
  });

  debtPaymentRows.forEach((row) => {
    activities.push({
      id: row.id ?? null,
      source: 'debt_payment',
      kind: 'debt_payment',
      category: null,
      amount: Number(row.amount ?? 0),
      paymentMethod: row.payment_method,
      comment: row.comment ?? null,
      createdAt: row.created_at ?? null,
    });
  });

  expenseRows
    .sort((rowA, rowB) => rowA.created_at.localeCompare(rowB.created_at))
    .forEach((row) => {
      activities.push({
        id: row.id,
        source: 'expense',
        kind: 'expense',
        category: row.category || 'other',
        amount: -Number(row.amount ?? 0),
        paymentMethod: row.payment_method ?? null,
        paymentSource: row.payment_source ?? null,
        ...(isDollarExpense(row) && row.usd_amount != null && row.usd_rate != null
          ? { dollars: { amount: Number(row.usd_amount), rate: Number(row.usd_rate) } }
          : {}),
        comment: row.comment,
        createdAt: row.created_at,
        ...(row.creator_name !== undefined ? { createdByName: row.creator_name } : {}),
      });
    });

  [...exchangeRows]
    .sort((rowA, rowB) => (rowA.created_at ?? '').localeCompare(rowB.created_at ?? ''))
    .forEach((row) => {
      activities.push({
        id: row.id,
        source: 'exchange',
        kind: 'exchange',
        category: null,
        amount: 0,
        paymentMethod: null,
        comment: row.comment || null,
        createdAt: row.created_at ?? null,
        ...(row.creator_name !== undefined ? { createdByName: row.creator_name } : {}),
        exchange: {
          from: row.from_method,
          to: row.to_method,
          fromAmount: Number(row.from_amount),
          toAmount: Number(row.to_amount),
          rate: row.rate === null ? null : Number(row.rate),
        },
      });
    });

  return activities;
}

export function buildMoneyReport(
  cashRows: MoneyReportCashRow[],
  expenseRows: ExpenseRow[],
  debtPaymentRows: MoneyReportDebtPaymentRow[] = [],
  barSalesRows: MoneyReportBarSalesRow[] = [],
  stockPurchaseRows: StockPurchaseCostRow[] = [],
  exchangeRows: MoneyExchangeRow[] = [],
  reserveMoves: readonly ReserveMove[] = [],
): MoneyReport {
  const paymentMethods = buildPaymentMethods(cashRows, expenseRows, debtPaymentRows, exchangeRows, reserveMoves);
  const usd = heldDollars(exchangeRows, expenseRows);
  const totalCollected = Object.values(paymentMethods)
    .reduce((sum, method) => sum + method.collected, 0);
  const gameClubLeft = gameClubLeftOf(paymentMethods);
  const barExpenses = expenseRows.reduce(
    (sum, row) => row.payment_source === 'bar' ? sum + Number(row.amount ?? 0) : sum,
    0,
  );
  const gameClubExpenses = sumGameClubPaidExpenses(expenseRows);
  // Bar purchases the reserve paid take nothing from the Bar; money it put in left it (156).
  const barReservePaid = expenseRows.reduce(
    (sum, row) => (row.payment_source === 'bar' && isReservePaidExpense(row) ? sum + Number(row.amount ?? 0) : sum),
    0,
  );
  const barLeft = calculateBarMoney(barSalesRows, stockPurchaseRows).barMoney - barExpenses + barReservePaid
    - reservedNetBy(reserveMoves, 'bar');
  const dates = Array.from(new Set([
    ...cashRows.map((row) => row.date),
    ...expenseRows.map((row) => row.date),
    ...debtPaymentRows.map((row) => row.date),
    ...exchangeRows.map((row) => row.date),
  ])).sort((a, b) => b.localeCompare(a));

  const cashByDate = new Map<string, MoneyReportCashRow[]>();
  const expensesByDate = new Map<string, ExpenseRow[]>();
  const debtPaymentsByDate = new Map<string, MoneyReportDebtPaymentRow[]>();
  const exchangesByDate = new Map<string, MoneyExchangeRow[]>();
  for (const row of exchangeRows) {
    const rows = exchangesByDate.get(row.date) ?? [];
    rows.push(row);
    exchangesByDate.set(row.date, rows);
  }
  for (const row of cashRows) {
    const rows = cashByDate.get(row.date) ?? [];
    rows.push(row);
    cashByDate.set(row.date, rows);
  }
  for (const row of expenseRows) {
    const rows = expensesByDate.get(row.date) ?? [];
    rows.push(row);
    expensesByDate.set(row.date, rows);
  }
  for (const row of debtPaymentRows) {
    const rows = debtPaymentsByDate.get(row.date) ?? [];
    rows.push(row);
    debtPaymentsByDate.set(row.date, rows);
  }

  const days = dates.map((date) => {
    const dayCashRows = cashByDate.get(date) ?? [];
    const dayExpenseRows = expensesByDate.get(date) ?? [];
    const dayDebtPaymentRows = debtPaymentsByDate.get(date) ?? [];
    const dayExchangeRows = exchangesByDate.get(date) ?? [];
    const dayMethods = buildPaymentMethods(
      dayCashRows,
      dayExpenseRows,
      dayDebtPaymentRows,
      dayExchangeRows,
    );
    const activities = buildDailyActivities(
      dayCashRows,
      dayExpenseRows,
      dayDebtPaymentRows,
      dayExchangeRows,
    );
    const day = {
      date,
      cash: dayMethods.cash.left,
      terminal: dayMethods.terminal.left,
      card: dayMethods.card.left,
      playstation: dayMethods.playstation.left,
      total: gameClubLeftOf(dayMethods),
      income: activities
        .filter((activity) => activity.amount > 0)
        .reduce((sum, activity) => sum + activity.amount, 0),
      expenses: activities
        .filter((activity) => activity.kind === 'expense')
        .reduce((sum, activity) => sum + Math.abs(activity.amount), 0),
      gameClubExpenses: sumGameClubPaidExpenses(dayExpenseRows),
      barExpenses: dayExpenseRows
        .reduce((sum, row) => row.payment_source === 'bar' ? sum + Number(row.amount ?? 0) : sum, 0),
      activities,
    };

    return day;
  });

  return { totalCollected, gameClubExpenses, barExpenses, gameClubLeft, barLeft, paymentMethods, usd, days };
}

/** Expenses paid from one side's money (no `source`: every expense). Unmarked rows are game club money. */
export function expensesFromSource<T extends Pick<ExpenseRow, 'payment_source'>>(
  rows: T[],
  source?: 'game_club' | 'bar' | null,
): T[] {
  if (!source) return rows;
  return rows.filter((row) => isBarPaidExpense(row) === (source === 'bar'));
}

export function buildFilteredMoneyReport(
  cashRows: MoneyReportCashRow[],
  expenseRows: ExpenseRow[],
  debtPaymentRows: MoneyReportDebtPaymentRow[] = [],
  categoryFilter: MoneyReportCategoryFilter = 'all',
  barSalesRows: MoneyReportBarSalesRow[] = [],
  stockPurchaseRows: StockPurchaseCostRow[] = [],
  exchangeRows: MoneyExchangeRow[] = [],
  reserveMoves: readonly ReserveMove[] = [],
): MoneyReport {
  if (categoryFilter === 'exchange') {
    return buildMoneyReport([], [], [], [], [], exchangeRows);
  }
  if (categoryFilter === 'money_in') {
    return buildMoneyReport(cashRows, [], debtPaymentRows);
  }
  if (categoryFilter === 'income') {
    return buildMoneyReport(cashRows, [], []);
  }
  if (categoryFilter === 'debt_payment') {
    return buildMoneyReport([], [], debtPaymentRows);
  }
  if (categoryFilter === 'expense') {
    return buildMoneyReport([], expenseRows, []);
  }
  if (categoryFilter.startsWith('expense:')) {
    const category = categoryFilter.slice('expense:'.length);
    return buildMoneyReport(
      [],
      expenseRows.filter((row) => row.category === category),
      [],
    );
  }

  // Reserve moves only belong to the whole picture; a filtered view shows its own rows.
  return buildMoneyReport(cashRows, expenseRows, debtPaymentRows, barSalesRows, stockPurchaseRows, exchangeRows, reserveMoves);
}

/**
 * The days of the month before `from` that a period starting mid-month leaves
 * out, or null when it starts on the 1st. Money is counted per month, so what
 * those days left in each method is still there when the period begins.
 */
export function openingBalanceRange(from: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  if (!match) return null;
  const day = Number(match[3]);
  if (day <= 1) return null;
  const previous = String(day - 1).padStart(2, '0');
  return { from: `${match[1]}-${match[2]}-01`, to: `${match[1]}-${match[2]}-${previous}` };
}

/**
 * What `withOpeningBalances` adds to the method cards from the earlier days of
 * the period's month, all methods together, or null when no opening applies.
 * The cards sum to `gameClubLeft` plus this.
 */
export function openingBalanceTotal(opening: MoneyReport['paymentMethods'] | null): number | null {
  if (!opening) return null;
  return Object.values(opening).reduce((sum, method) => sum + method.left, 0);
}

/** Each payment method's money left, as `moneyStillHeldByMethod` and `summarizeMoneyWhereabouts` take it. */
export function moneyLeftByMethod(methods: MoneyReport['paymentMethods']): Record<keyof MoneyReport['paymentMethods'], number> {
  return {
    cash: methods.cash.left,
    terminal: methods.terminal.left,
    card: methods.card.left,
    playstation: methods.playstation.left,
  };
}

/** The first day any ledger may hold, as Owner Profit reads every exchange since. */
export const LEDGER_START_DATE = '2000-01-01';

/**
 * Every day before a period starts, from `LEDGER_START_DATE`: the exchanges and
 * dollar expenses that decide the dollars held when it begins. Null when
 * nothing comes before it.
 */
export function earlierDaysRange(from: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  if (!match || from <= LEDGER_START_DATE) return null;
  const previous = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1));
  return { from: LEDGER_START_DATE, to: previous.toISOString().slice(0, 10) };
}

/**
 * Dollars held at a period's last day: what every earlier exchange and dollar
 * expense left (`earlierDaysRange`), plus the period's own movement
 * (`MoneyReport.usd`). Never added to a UZS figure.
 */
export function dollarsHeldAtPeriodEnd(
  earlierExchanges: MoneyExchangeRow[],
  earlierDollarExpenses: readonly DollarExpenseRow[],
  periodMovement: number,
): number {
  return Math.round((heldDollars(earlierExchanges, earlierDollarExpenses) + periodMovement) * 100) / 100;
}

/**
 * Adds what each method held when the period began (the money left by
 * `openingBalanceRange`) to its card, so an exchange or expense paid with
 * money collected earlier in the month does not show the method as negative.
 */
export function withOpeningBalances(
  methods: MoneyReport['paymentMethods'],
  opening: MoneyReport['paymentMethods'] | null,
): MoneyReport['paymentMethods'] {
  if (!opening) return methods;
  const add = (key: keyof MoneyReport['paymentMethods']): MoneyReportPaymentBreakdown => ({
    ...methods[key],
    opening: opening[key].left,
    left: methods[key].left + opening[key].left,
  });
  return { cash: add('cash'), terminal: add('terminal'), card: add('card'), playstation: add('playstation') };
}
