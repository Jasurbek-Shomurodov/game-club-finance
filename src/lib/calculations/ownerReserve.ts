import { sumAvailableMoneyResults, type AvailableMoneyByMonth, type AvailableSourceBalance } from './availableMoney';
import type { MoneyExchangeRow } from './moneyExchanges';
import {
  OWNER_RESERVE_METHODS,
  type OwnerReserveEntry,
  type OwnerReserveMethod,
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
  byMethod: Record<OwnerReserveMethod, ReserveFlow>;
}

const emptyFlow = (): ReserveFlow => ({ deposited: 0, returned: 0, spent: 0 });
const methodRecord = <T>(make: () => T) => Object.fromEntries(
  OWNER_RESERVE_METHODS.map((method) => [method, make()]),
) as Record<OwnerReserveMethod, T>;

/** The Game Club method a reserve purchase draws on, bucketed like migration 125 (dollars apart, 143); null for Bar. */
export function reserveExpenseMethod(source: string | null, method: string | null): OwnerReserveMethod | null {
  if ((source ?? 'game_club') !== 'game_club') return null;
  return method === 'cash' || method === 'terminal' || method === 'playstation' || method === 'usd' ? method : 'card';
}

/** A reserve entry, or one that stands for a dollar exchange (143) and is undone by deleting it. */
export type ReserveLedgerEntry = OwnerReserveEntry & { exchange_id?: string | null };

/**
 * The reserve's dollars (143), as owner_reserve_dollar_exchanges reads them:
 * an exchange into dollars is a Game Club deposit of the sums paid, and one
 * out of dollars returns the sums received, both in the exchange's month.
 * They are undone only by deleting the exchange.
 */
export function dollarReserveEntries(exchanges: readonly MoneyExchangeRow[], clubId: string): ReserveLedgerEntry[] {
  return exchanges.flatMap((row): ReserveLedgerEntry[] => {
    const bought = row.to_method === 'usd';
    if (!bought && row.from_method !== 'usd') return [];
    return [{
      id: `exchange:${row.id}`,
      club_id: clubId,
      kind: bought ? 'deposit' : 'return',
      period_month: `${row.date.slice(0, 7)}-01`,
      source: 'game_club',
      payment_method: 'usd',
      amount: Number(bought ? row.from_amount : row.to_amount),
      comment: row.comment || null,
      collection_date: null,
      exchange_id: row.id,
      created_by: row.created_by ?? '',
      created_at: row.created_at ?? `${row.date}T00:00:00`,
    }];
  });
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
  /** Game Club only: what each method holds; `usd` is the sums value of the dollars. */
  byMethod: Record<OwnerReserveMethod, number>;
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
  | { kind: 'deposit' | 'return'; id: string; date: string; source: OwnerWithdrawalSource; amount: number; method: OwnerReserveMethod | null; note: string | null; createdAt: string; entry: ReserveLedgerEntry }
  | { kind: 'purchase'; id: string; date: string; source: OwnerWithdrawalSource; amount: number; method: OwnerReserveMethod | null; note: string | null; createdAt: string; category: string };

/** Every deposit, return and purchase, newest first. Deposits and returns are dated by when they were made. */
export function reserveActivity(
  entries: readonly ReserveLedgerEntry[],
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

export interface ReserveMonthRow {
  /** YYYY-MM */
  month: string;
  /** Money put in that month: deposits, dollar exchanges included. */
  deposited: number;
  /** Money that left: returns to profit plus purchases the reserve paid. */
  withdrawn: number;
  /** What each side holds at the end of the month. */
  gameClubHeld: number;
  barHeld: number;
}

/**
 * Month by month, from the first reserve activity through `throughMonth`:
 * what went in, what left, and what each side holds at the month's end.
 * Months with no activity are filled in so the balance line is continuous.
 */
export function reserveMonthlySeries(
  entries: readonly ReserveLedgerEntry[],
  expenses: readonly ReservePaidExpense[],
  throughMonth: string,
): ReserveMonthRow[] {
  const months = [
    ...entries.map((entry) => entry.period_month.slice(0, 7)),
    ...expenses.map((expense) => expense.date.slice(0, 7)),
  ].filter((month) => month <= throughMonth).sort();
  if (months.length === 0) return [];

  const rows: ReserveMonthRow[] = [];
  const held = { game_club: 0, bar: 0 };
  let [year, month] = months[0].split('-').map(Number);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (key > throughMonth) break;
    const { bySource } = reserveForMonth(entries, expenses, key);
    for (const side of ['game_club', 'bar'] as const) {
      held[side] += bySource[side].deposited - bySource[side].returned - bySource[side].spent;
    }
    rows.push({
      month: key,
      deposited: bySource.game_club.deposited + bySource.bar.deposited,
      withdrawn: bySource.game_club.returned + bySource.game_club.spent + bySource.bar.returned + bySource.bar.spent,
      gameClubHeld: held.game_club,
      barHeld: held.bar,
    });
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return rows;
}

/**
 * Splits everything left of a month's Game Club profit over its payment methods,
 * the way the database limits deposits: no method above what it holds, and
 * together never above what Game Club has left.
 */
export function planGameClubDepositAll(
  methods: readonly { method: OwnerWithdrawalPaymentMethod; available: number }[],
  gameClubAvailable: number,
): { method: OwnerWithdrawalPaymentMethod; amount: number }[] {
  const plan: { method: OwnerWithdrawalPaymentMethod; amount: number }[] = [];
  let left = Math.max(0, gameClubAvailable);
  for (const row of methods) {
    const amount = Math.min(Math.max(0, row.available), left);
    if (amount <= 0) continue;
    plan.push({ method: row.method, amount });
    left -= amount;
  }
  return plan;
}
