import { sumAvailableMoneyResults, type AvailableMoneyByMonth, type AvailableSourceBalance } from './availableMoney';
import {
  OWNER_WITHDRAWAL_PAYMENT_METHODS,
  type OwnerReserveEntry,
  type OwnerWithdrawalPaymentMethod,
  type OwnerWithdrawalSource,
} from '@/types';

/** An expense paid from the owner reserve (migration 136). */
export interface ReservePaidExpense {
  id: string;
  date: string;
  amount: number;
  payment_source: OwnerWithdrawalSource | null;
  payment_method: string | null;
  category: string;
  comment: string | null;
  created_at: string;
}

export interface ReserveFlow {
  /** Owner profit put into the reserve. */
  deposited: number;
  /** Reserve money given back to owner profit. */
  returned: number;
  /** Purchases the reserve paid for. */
  spent: number;
}

export interface MonthReserve {
  bySource: Record<OwnerWithdrawalSource, ReserveFlow>;
  byMethod: Record<OwnerWithdrawalPaymentMethod, ReserveFlow>;
}

const emptyFlow = (): ReserveFlow => ({ deposited: 0, returned: 0, spent: 0 });
const methodRecord = <T>(make: () => T) => Object.fromEntries(
  OWNER_WITHDRAWAL_PAYMENT_METHODS.map((method) => [method, make()]),
) as Record<OwnerWithdrawalPaymentMethod, T>;

/** The Game Club method a reserve purchase draws on, bucketed like migration 125; null for Bar. */
export function reserveExpenseMethod(source: string | null, method: string | null): OwnerWithdrawalPaymentMethod | null {
  if ((source ?? 'game_club') !== 'game_club') return null;
  return method === 'cash' || method === 'terminal' || method === 'playstation' ? method : 'card';
}

const sideOf = (source: string | null): OwnerWithdrawalSource => (source === 'bar' ? 'bar' : 'game_club');

/** Reserve activity of one YYYY-MM month: deposits and returns by their month, purchases by their date. */
export function reserveForMonth(
  entries: readonly OwnerReserveEntry[],
  expenses: readonly ReservePaidExpense[],
  month: string,
): MonthReserve {
  const result: MonthReserve = { bySource: { game_club: emptyFlow(), bar: emptyFlow() }, byMethod: methodRecord(emptyFlow) };
  for (const entry of entries) {
    if (entry.period_month.slice(0, 7) !== month) continue;
    const key = entry.kind === 'deposit' ? 'deposited' : 'returned';
    const amount = Number(entry.amount);
    result.bySource[entry.source][key] += amount;
    if (entry.source === 'game_club' && entry.payment_method) result.byMethod[entry.payment_method][key] += amount;
  }
  for (const expense of expenses) {
    if (expense.date.slice(0, 7) !== month) continue;
    const amount = Number(expense.amount);
    result.bySource[sideOf(expense.payment_source)].spent += amount;
    const method = reserveExpenseMethod(expense.payment_source, expense.payment_method);
    if (method) result.byMethod[method].spent += amount;
  }
  return result;
}

/** Net money the month put into the reserve: deposits minus returns. */
export const reservedNet = (flow: ReserveFlow) => flow.deposited - flow.returned;

function withReserve(balance: AvailableSourceBalance, flow: ReserveFlow): AvailableSourceBalance {
  // The reserve paid for its purchases, so they are not this month's cost.
  const earned = balance.earned + flow.spent;
  const available = balance.available + flow.spent - reservedNet(flow);
  return { ...balance, earned, available, overdrawnBy: Math.max(0, -available) };
}

/**
 * Applies the reserve to month balances, as owner_source_earned_for_month does
 * in the database: a deposit leaves the month's available profit (it is not a
 * withdrawal), a return joins it, and a reserve purchase is taken back out of
 * the month's costs. Months after `throughMonth` are left out.
 */
export function applyOwnerReserve(
  byMonth: AvailableMoneyByMonth,
  entries: readonly OwnerReserveEntry[],
  expenses: readonly ReservePaidExpense[],
  throughMonth?: string,
): AvailableMoneyByMonth {
  const months = new Set(Object.keys(byMonth));
  for (const entry of entries) months.add(entry.period_month.slice(0, 7));
  for (const expense of expenses) months.add(expense.date.slice(0, 7));

  const result: AvailableMoneyByMonth = {};
  for (const month of [...months].sort()) {
    if (throughMonth !== undefined && month > throughMonth) continue;
    const base = byMonth[month] ?? sumAvailableMoneyResults([]);
    const { bySource } = reserveForMonth(entries, expenses, month);
    const gameClub = withReserve(base.gameClub, bySource.game_club);
    const bar = withReserve(base.bar, bySource.bar);
    result[month] = {
      ...base,
      gameClub,
      bar,
      hasOverWithdrawal: gameClub.overdrawnBy > 0 || bar.overdrawnBy > 0 || base.invalidWithdrawals.length > 0,
    };
  }
  return result;
}

export interface ReserveBalance extends ReserveFlow {
  /** What the reserve holds now: deposited - returned - spent. */
  held: number;
  /** Game Club only: what each method holds. */
  byMethod: Record<OwnerWithdrawalPaymentMethod, number>;
}

/** What the reserve holds per side, over all time, as owner_reserve_balance does. */
export function reserveBalances(
  entries: readonly OwnerReserveEntry[],
  expenses: readonly ReservePaidExpense[],
): Record<OwnerWithdrawalSource, ReserveBalance> {
  const make = (): ReserveBalance => ({ ...emptyFlow(), held: 0, byMethod: methodRecord(() => 0) });
  const result: Record<OwnerWithdrawalSource, ReserveBalance> = { game_club: make(), bar: make() };
  for (const entry of entries) {
    const amount = Number(entry.amount);
    const side = result[entry.source];
    const sign = entry.kind === 'deposit' ? 1 : -1;
    side[entry.kind === 'deposit' ? 'deposited' : 'returned'] += amount;
    side.held += sign * amount;
    if (entry.source === 'game_club' && entry.payment_method) side.byMethod[entry.payment_method] += sign * amount;
  }
  for (const expense of expenses) {
    const amount = Number(expense.amount);
    const side = result[sideOf(expense.payment_source)];
    side.spent += amount;
    side.held -= amount;
    const method = reserveExpenseMethod(expense.payment_source, expense.payment_method);
    if (method) side.byMethod[method] -= amount;
  }
  return result;
}

export type ReserveActivity =
  | { kind: 'deposit' | 'return'; id: string; date: string; source: OwnerWithdrawalSource; amount: number; method: OwnerWithdrawalPaymentMethod | null; note: string | null; createdAt: string; entry: OwnerReserveEntry }
  | { kind: 'purchase'; id: string; date: string; source: OwnerWithdrawalSource; amount: number; method: OwnerWithdrawalPaymentMethod | null; note: string | null; createdAt: string; category: string };

/** Every deposit, return and purchase, newest first. Deposits and returns are dated by when they were made. */
export function reserveActivity(
  entries: readonly OwnerReserveEntry[],
  expenses: readonly ReservePaidExpense[],
): ReserveActivity[] {
  return [
    ...entries.map((entry): ReserveActivity => ({
      kind: entry.kind, id: entry.id, date: entry.created_at.slice(0, 10), source: entry.source, amount: Number(entry.amount),
      method: entry.payment_method, note: entry.comment, createdAt: entry.created_at, entry,
    })),
    ...expenses.map((expense): ReserveActivity => ({
      kind: 'purchase', id: expense.id, date: expense.date, source: sideOf(expense.payment_source), amount: Number(expense.amount),
      method: reserveExpenseMethod(expense.payment_source, expense.payment_method), note: expense.comment, createdAt: expense.created_at,
      category: expense.category,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/** Progress towards a goal, 0-100. */
export function reserveGoalPercent(held: number, target: number): number {
  return target > 0 ? Math.max(0, Math.min(100, Math.round((held / target) * 100))) : 0;
}
