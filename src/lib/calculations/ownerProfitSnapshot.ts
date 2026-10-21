import {
  OWNER_WITHDRAWAL_PAYMENT_METHODS,
  type OwnerProfitCarryover,
  type OwnerWithdrawal,
  type OwnerWithdrawalPaymentMethod,
  type OwnerWithdrawalSource,
} from '../../types';
import {
  sumAvailableMoneyResults,
  type AvailableSourceBalance,
  type AvailableMoneyByMonth,
  type AvailableMoneyResult,
} from './availableMoney';
import {
  calculateGameClubMoneyLeftByPaymentMethod,
  emptyMoneyLeftByPaymentMethod,
  type DailyCashRow,
  type DebtPaymentValueRow,
  type ExpenseRow,
  type MoneyLeftByPaymentMethod,
} from './dashboardMetrics';

export interface OwnerProfitMonthlyBalanceRow {
  period_month: string;
  game_club_earned: number;
  bar_earned: number;
  game_club_withdrawn: number;
  bar_withdrawn: number;
}

export interface OwnerProfitSnapshotPayload {
  monthlyBalances: OwnerProfitMonthlyBalanceRow[];
  withdrawalRows: OwnerWithdrawal[];
  paymentMethodBalancesByMonth?: Record<string, Partial<MoneyLeftByPaymentMethod>>;
  paymentMethodBalances?: Partial<MoneyLeftByPaymentMethod>;
}

function sourceBalance(earned: number, withdrawn: number) {
  const available = earned - withdrawn;

  return {
    earned,
    withdrawn,
    available,
    overdrawnBy: Math.max(0, -available),
  };
}

export function buildOwnerProfitSnapshot(payload: OwnerProfitSnapshotPayload): {
  byMonth: AvailableMoneyByMonth;
  total: AvailableMoneyResult;
  withdrawals: OwnerWithdrawal[];
  paymentMethodBalancesByMonth: Record<string, MoneyLeftByPaymentMethod>;
  paymentMethodBalances: MoneyLeftByPaymentMethod;
} {
  const byMonth = payload.monthlyBalances.reduce<AvailableMoneyByMonth>((result, row) => {
    const month = row.period_month.slice(0, 7);
    const gameClub = sourceBalance(
      Number(row.game_club_earned ?? 0),
      Number(row.game_club_withdrawn ?? 0),
    );
    const bar = sourceBalance(
      Number(row.bar_earned ?? 0),
      Number(row.bar_withdrawn ?? 0),
    );

    result[month] = {
      gameClub,
      bar,
      hasOverWithdrawal: gameClub.overdrawnBy > 0 || bar.overdrawnBy > 0,
      invalidWithdrawals: [],
    };
    return result;
  }, {});

  return {
    byMonth,
    total: sumAvailableMoneyResults(Object.values(byMonth)),
    withdrawals: payload.withdrawalRows,
    paymentMethodBalancesByMonth: Object.fromEntries(
      Object.entries(payload.paymentMethodBalancesByMonth ?? {}).map(([month, balances]) => [month, {
        ...emptyMoneyLeftByPaymentMethod,
        ...Object.fromEntries(Object.entries(balances).map(([method, amount]) => [method, Number(amount ?? 0)])),
      }]),
    ),
    paymentMethodBalances: {
      ...emptyMoneyLeftByPaymentMethod,
      ...Object.fromEntries(Object.entries(payload.paymentMethodBalances ?? {}).map(
        ([method, amount]) => [method, Number(amount ?? 0)],
      )),
    },
  };
}

export interface PaymentMethodWithdrawalBalance {
  method: OwnerWithdrawalPaymentMethod;
  /** Game Club money left in this method after operating expenses, before withdrawals. */
  earned: number;
  /** Net money carried into this month (positive) or on to the next month (negative). */
  carried: number;
  withdrawn: number;
  available: number;
}

export interface GameClubWithdrawalsByMethod {
  methods: PaymentMethodWithdrawalBalance[];
  /** Game Club withdrawals recorded without a payment method (older rows, or All). */
  unassignedWithdrawn: number;
}

/**
 * Splits one month's Game Club withdrawals by payment method. Unassigned
 * withdrawals are reported separately and never guessed into a method.
 */
export function gameClubWithdrawalsByMethod(
  balances: MoneyLeftByPaymentMethod,
  withdrawals: readonly OwnerWithdrawal[],
  month: string,
  carryovers: readonly OwnerProfitCarryover[] = [],
): GameClubWithdrawalsByMethod {
  const { byMethod } = carryoversForMonth(carryovers, month);
  const withdrawn = Object.fromEntries(
    OWNER_WITHDRAWAL_PAYMENT_METHODS.map((method) => [method, 0]),
  ) as Record<OwnerWithdrawalPaymentMethod, number>;
  let unassignedWithdrawn = 0;

  for (const row of withdrawals) {
    if (row.source !== 'game_club' || row.period_month.slice(0, 7) !== month) continue;
    const amount = Number(row.amount ?? 0);
    if (row.payment_method && row.payment_method in withdrawn) withdrawn[row.payment_method] += amount;
    else unassignedWithdrawn += amount;
  }

  return {
    methods: OWNER_WITHDRAWAL_PAYMENT_METHODS.map((method) => {
      const earned = Number(balances[method] ?? 0);
      const carried = byMethod[method];
      return { method, earned, carried, withdrawn: withdrawn[method], available: earned + carried - withdrawn[method] };
    }),
    unassignedWithdrawn,
  };
}

/** What can still be taken from one method: never more than the Game Club month balance. */
export function availableForPaymentMethod(methodAvailable: number, gameClubAvailable: number): number {
  return Math.max(0, Math.min(methodAvailable, gameClubAvailable));
}

export interface MonthCarryovers {
  /** Net carried per source: money in from the previous month minus money on to the next. */
  bySource: Record<OwnerWithdrawalSource, number>;
  /** Net carried per Game Club payment method. */
  byMethod: Record<OwnerWithdrawalPaymentMethod, number>;
}

/** Net carryovers touching one YYYY-MM month: incoming adds, outgoing subtracts. */
export function carryoversForMonth(
  carryovers: readonly OwnerProfitCarryover[],
  month: string,
): MonthCarryovers {
  const bySource: Record<OwnerWithdrawalSource, number> = { game_club: 0, bar: 0 };
  const byMethod = Object.fromEntries(
    OWNER_WITHDRAWAL_PAYMENT_METHODS.map((method) => [method, 0]),
  ) as Record<OwnerWithdrawalPaymentMethod, number>;

  for (const row of carryovers) {
    const sign = row.to_month.slice(0, 7) === month ? 1 : row.from_month.slice(0, 7) === month ? -1 : 0;
    if (sign === 0) continue;
    const amount = sign * Number(row.amount ?? 0);
    bySource[row.source] += amount;
    if (row.source === 'game_club' && row.payment_method && row.payment_method in byMethod) {
      byMethod[row.payment_method] += amount;
    }
  }

  return { bySource, byMethod };
}

function withCarried(balance: AvailableSourceBalance, carried: number): AvailableSourceBalance {
  const available = balance.available + carried;
  return { ...balance, available, overdrawnBy: Math.max(0, -available) };
}

/**
 * Applies carryovers to independent month balances. Earnings and withdrawals
 * stay as recorded; only what is left to take moves between months. Months
 * after `throughMonth` (YYYY-MM) are left out, like future withdrawals.
 */
export function applyOwnerProfitCarryovers(
  byMonth: AvailableMoneyByMonth,
  carryovers: readonly OwnerProfitCarryover[],
  throughMonth?: string,
): AvailableMoneyByMonth {
  const months = new Set(Object.keys(byMonth));
  for (const row of carryovers) {
    months.add(row.from_month.slice(0, 7));
    months.add(row.to_month.slice(0, 7));
  }

  const result: AvailableMoneyByMonth = {};
  for (const month of [...months].sort()) {
    if (throughMonth !== undefined && month > throughMonth) continue;
    const base = byMonth[month] ?? sumAvailableMoneyResults([]);
    const { bySource } = carryoversForMonth(carryovers, month);
    const gameClub = withCarried(base.gameClub, bySource.game_club);
    const bar = withCarried(base.bar, bySource.bar);
    result[month] = {
      ...base,
      gameClub,
      bar,
      hasOverWithdrawal: gameClub.overdrawnBy > 0 || bar.overdrawnBy > 0 || base.invalidWithdrawals.length > 0,
    };
  }
  return result;
}

/**
 * Game Club money left per payment method for every month with activity,
 * keyed `YYYY-MM`. Groups the ledgers by month once, then applies the canonical
 * per-method calculation to each month.
 */
export function gameClubMoneyLeftByPaymentMethodByMonth(
  cashRows: readonly DailyCashRow[],
  expenseRows: readonly ExpenseRow[],
  debtPaymentRows: readonly DebtPaymentValueRow[],
): Record<string, MoneyLeftByPaymentMethod> {
  const months = new Map<string, { cash: DailyCashRow[]; expenses: ExpenseRow[]; debtPayments: DebtPaymentValueRow[] }>();
  const bucket = (date: string) => {
    const month = date.slice(0, 7);
    let rows = months.get(month);
    if (!rows) {
      rows = { cash: [], expenses: [], debtPayments: [] };
      months.set(month, rows);
    }
    return rows;
  };
  for (const row of cashRows) bucket(row.date).cash.push(row);
  for (const row of expenseRows) bucket(row.date).expenses.push(row);
  for (const row of debtPaymentRows) bucket(row.date).debtPayments.push(row);

  return Object.fromEntries([...months].map(([month, rows]) => [
    month,
    calculateGameClubMoneyLeftByPaymentMethod(rows.cash, rows.expenses, rows.debtPayments),
  ]));
}
