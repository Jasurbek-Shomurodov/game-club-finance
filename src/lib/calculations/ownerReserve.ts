import { sumAvailableMoneyResults, type AvailableMoneyByMonth, type AvailableSourceBalance } from './availableMoney';
import { dollarsForMonth, type DollarExpenseRow, type ExchangeMethod, type MoneyExchangeRow } from './moneyExchanges';
import {
  OWNER_RESERVE_METHODS,
  OWNER_WITHDRAWAL_PAYMENT_METHODS,
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
  /** A USD-account expense (143): the dollars spent and what each cost (184), joined from the dollar expense read. */
  usd_amount?: number | string | null;
  usd_rate?: number | string | null;
}

/**
 * The dollars of a USD-account expense and what each cost, in sums (184), when
 * they were read; null on a sums purchase or when the dollars are unknown.
 */
export function reservePurchaseDollars(expense: Pick<ReservePaidExpense, 'payment_method' | 'usd_amount' | 'usd_rate'>): { amount: number; rate: number } | null {
  return expense.payment_method === 'usd' && expense.usd_amount != null && expense.usd_rate != null
    ? { amount: Number(expense.usd_amount), rate: Number(expense.usd_rate) }
    : null;
}

/**
 * Gives each USD-account purchase its dollars and cost per dollar from the
 * dollar expense read (124), matched by id; sums purchases stay as they are.
 */
export function withReservePurchaseDollars<T extends ReservePaidExpense>(
  expenses: readonly T[],
  dollarExpenses: ReadonlyArray<{ id: string; usd_amount: number | string | null; usd_rate: number | string | null }>,
): T[] {
  const byId = new Map(dollarExpenses.map((row) => [row.id, row]));
  return expenses.map((expense) => {
    const dollars = expense.payment_method === 'usd' ? byId.get(expense.id) : undefined;
    return dollars ? { ...expense, usd_amount: dollars.usd_amount, usd_rate: dollars.usd_rate } : expense;
  });
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

/**
 * A reserve entry, or one that stands for a dollar exchange (143) and is
 * undone by deleting it. Those carry the exchange's dollars, rate and the
 * sums method on its other side.
 */
export type ReserveLedgerEntry = OwnerReserveEntry & {
  exchange_id?: string | null;
  usd_amount?: number;
  rate?: number | null;
  exchange_method?: ExchangeMethod;
};

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
      entry_date: row.date,
      exchange_id: row.id,
      usd_amount: Number(bought ? row.to_amount : row.from_amount),
      rate: row.rate === null || row.rate === undefined ? null : Number(row.rate),
      exchange_method: bought ? row.from_method : row.to_method,
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
  /**
   * An expense the reserve paid: `amount` is the sums it counts as. One paid
   * from the USD account carries its `dollars` and their cost per dollar (184).
   */
  | { kind: 'purchase'; id: string; date: string; source: OwnerWithdrawalSource; amount: number; method: OwnerReserveMethod | null; note: string | null; createdAt: string; category: string; dollars?: { amount: number; rate: number } | null }
  /**
   * Dollars bought with the reserve's sums or sold for them (170): `id` is the
   * exchange's, `amount` the sums, `method` the method the sums passed through.
   * The reserve's total does not change.
   */
  | { kind: 'exchange'; id: string; date: string; source: 'game_club'; amount: number; method: OwnerReserveMethod | null; note: string | null; createdAt: string; direction: 'buy' | 'sell'; usd: number; rate: number | null; entry: ReserveLedgerEntry };

/** Exchange ids whose sums half is a reserve entry: the dollars were bought or sold inside the reserve (170). */
export function pairedExchangeIds(entries: readonly ReserveLedgerEntry[]): Set<string> {
  return new Set(entries.flatMap((entry) => (entry.paired_exchange_id ? [entry.paired_exchange_id] : [])));
}

/** True for either half of an exchange inside the reserve: it moves nothing into or out of it. */
const isReserveExchangeLeg = (entry: ReserveLedgerEntry, paired: ReadonlySet<string>) => (
  Boolean(entry.paired_exchange_id) || Boolean(entry.exchange_id && paired.has(entry.exchange_id))
);

/**
 * The day a deposit or return moved money: its own date (162), else, as the
 * database dated it before, the day it was recorded, kept inside its month.
 */
export function reserveEntryDate(entry: Pick<ReserveLedgerEntry, 'entry_date' | 'created_at' | 'period_month'>): string {
  if (entry.entry_date) return entry.entry_date.slice(0, 10);
  const recorded = entry.created_at.slice(0, 10);
  const monthStart = entry.period_month.slice(0, 10);
  const [year, month] = monthStart.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return recorded < monthStart ? monthStart : recorded > monthEnd ? monthEnd : recorded;
}

/**
 * Every deposit, return, purchase and exchange inside the reserve, newest
 * first. Deposits and returns are dated by the day the money moved. The two
 * halves of an exchange inside the reserve (170) are one row.
 */
export function reserveActivity(
  entries: readonly ReserveLedgerEntry[],
  expenses: readonly ReservePaidExpense[],
): ReserveActivity[] {
  const paired = pairedExchangeIds(entries);
  const sumsHalf = new Map(entries.flatMap((entry) => (entry.paired_exchange_id ? [[entry.paired_exchange_id, entry] as const] : [])));
  return [
    ...entries.flatMap((entry): ReserveActivity[] => {
      if (entry.paired_exchange_id) return [];
      if (entry.exchange_id && paired.has(entry.exchange_id)) {
        const half = sumsHalf.get(entry.exchange_id);
        return [{
          kind: 'exchange', id: entry.exchange_id, date: reserveEntryDate(entry), source: 'game_club', amount: Number(entry.amount),
          method: half?.payment_method ?? null, note: entry.comment, createdAt: entry.created_at,
          direction: entry.kind === 'deposit' ? 'buy' : 'sell', usd: entry.usd_amount ?? 0, rate: entry.rate ?? null, entry,
        }];
      }
      return [{
        kind: entry.kind, id: entry.id, date: reserveEntryDate(entry), source: entry.source, amount: Number(entry.amount),
        method: entry.payment_method, note: entry.comment, createdAt: entry.created_at, entry,
      }];
    }),
    ...expenses.map((expense): ReserveActivity => {
      const dollars = reservePurchaseDollars(expense);
      return {
        kind: 'purchase', id: expense.id, date: expense.date, source: sideOf(expense.payment_source), amount: Number(expense.amount),
        method: reserveExpenseMethod(expense.payment_source, expense.payment_method), note: expense.comment, createdAt: expense.created_at,
        category: expense.category, ...(dollars ? { dollars } : {}),
      };
    }),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export interface ReserveActivityDay {
  /** YYYY-MM-DD */
  date: string;
  rows: ReserveActivity[];
  /** Money that went in that day. */
  deposited: number;
  /** Money that left that day: returns plus purchases. */
  withdrawn: number;
}

/** Activity bucketed by day, keeping the incoming order (newest first), with each day's in and out. */
export function groupReserveActivityByDay(activity: readonly ReserveActivity[]): ReserveActivityDay[] {
  const days: ReserveActivityDay[] = [];
  for (const row of activity) {
    let day = days[days.length - 1];
    if (!day || day.date !== row.date) {
      day = { date: row.date, rows: [], deposited: 0, withdrawn: 0 };
      days.push(day);
    }
    day.rows.push(row);
    // An exchange inside the reserve only swaps sums for dollars.
    if (row.kind === 'deposit') day.deposited += row.amount;
    else if (row.kind !== 'exchange') day.withdrawn += row.amount;
  }
  return days;
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
  // Both halves of an exchange inside the reserve fall in one month and cancel out (170).
  const paired = pairedExchangeIds(entries);
  entries = entries.filter((entry) => !isReserveExchangeLeg(entry, paired));
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

export interface ReserveDayRow {
  /** YYYY-MM-DD */
  date: string;
  /** What the reserve holds at the end of the day, as one pot, never below zero. */
  held: number;
}

const nextIsoDay = (date: string) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

/**
 * Day by day, from the first reserve activity through `throughDate` (the
 * club's business today): what the reserve holds at the end of the day. Days
 * are those of the history list, so the line moves on the day a row appears
 * there. A purchase can be dated before the deposits that paid for it were
 * recorded (October rent paid on the 31st from money put in on 2 November), so
 * the running total can dip below zero; the reserve never held less than
 * nothing, so such days show as empty and the total catches up when the money
 * is recorded.
 */
export function reserveDailySeries(
  entries: readonly ReserveLedgerEntry[],
  expenses: readonly ReservePaidExpense[],
  throughDate: string,
): ReserveDayRow[] {
  const change = new Map<string, number>();
  for (const row of reserveActivity(entries, expenses)) {
    const day = row.date > throughDate ? throughDate : row.date;
    const amount = row.kind === 'deposit' ? row.amount : row.kind === 'exchange' ? 0 : -row.amount;
    change.set(day, (change.get(day) ?? 0) + amount);
  }
  if (change.size === 0) return [];

  const rows: ReserveDayRow[] = [];
  let running = 0;
  for (let day = [...change.keys()].sort()[0]; day <= throughDate; day = nextIsoDay(day)) {
    running += change.get(day) ?? 0;
    rows.push({ date: day, held: Math.max(0, running) });
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

/** Game Club amounts by payment method, as the reserve deposit form holds them. */
export type ReserveDepositAmounts = Partial<Record<OwnerWithdrawalPaymentMethod, number>>;

/** A whole, non-negative sum; anything that is not a finite number is nothing. */
const wholeSum = (value: number | null | undefined) => (
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
);

/**
 * Where the reserve deposit form starts, per Game Club method: what was asked
 * for (an income entry's split), never more than the till holds on the chosen
 * day. Asked for nothing (the page's "Put in"): everything the till holds.
 * Whole sums only, as the database stores them.
 */
export function reserveDepositPrefill(
  wanted: ReserveDepositAmounts | null | undefined,
  till: ReserveDepositAmounts,
): Record<OwnerWithdrawalPaymentMethod, number> {
  const askedFor = Boolean(wanted) && Object.keys(wanted as object).length > 0;
  return Object.fromEntries(OWNER_WITHDRAWAL_PAYMENT_METHODS.map((method) => {
    const held = wholeSum(till[method]);
    return [method, askedFor ? Math.min(wholeSum(wanted?.[method]), held) : held];
  })) as Record<OwnerWithdrawalPaymentMethod, number>;
}

/** The parts of one deposit: a whole, positive amount for each shown method, in the order shown. */
export function reserveDepositParts(
  amounts: ReserveDepositAmounts,
  methods: readonly OwnerWithdrawalPaymentMethod[],
): { method: OwnerWithdrawalPaymentMethod; amount: number }[] {
  return methods
    .map((method) => ({ method, amount: wholeSum(amounts[method]) }))
    .filter((part) => part.amount > 0);
}

/**
 * What went into and out of the reserve, as its history shows it: deposits,
 * returns to profit and purchases. Exchanges inside the reserve (170) move
 * nothing in or out, so they are counted apart.
 */
export function reserveFlowTotals(activity: readonly ReserveActivity[]): ReserveFlow & { exchanged: number } {
  const totals = { ...emptyFlow(), exchanged: 0 };
  for (const row of activity) {
    if (row.kind === 'deposit') totals.deposited += row.amount;
    else if (row.kind === 'return') totals.returned += row.amount;
    else if (row.kind === 'purchase') totals.spent += row.amount;
    else totals.exchanged += 1;
  }
  return totals;
}

/**
 * What moved into and out of the reserve's sums (its UZS account, 155) in one
 * YYYY-MM month, through `throughDate`, counted the way `reserveHoldingsOn`
 * counts the sums, so the sums at the end of the month before + in - out =
 * the sums on `throughDate`. Its USD account stays apart: dollars bought or
 * sold from the till and Game Club purchases paid in dollars are not sums
 * moves. Dollars bought inside the reserve (170) are: the sums paid for them
 * leave the sums (out), and the sums a sale brings in arrive (in).
 * Deposits and returns are dated by the day the money moved.
 */
export function reserveMonthMoves(
  entries: readonly ReserveLedgerEntry[],
  expenses: readonly ReservePaidExpense[],
  month: string,
  throughDate: string,
): { in: number; out: number } {
  const inMonth = (date: string) => date.slice(0, 7) === month && date <= throughDate;
  const moves = { in: 0, out: 0 };
  for (const entry of entries) {
    // The USD account's half: an exchange through dollars (143), as reserveSumsHeld leaves it out.
    if (entry.source === 'game_club' && entry.payment_method === 'usd') continue;
    if (!inMonth(reserveEntryDate(entry))) continue;
    moves[entry.kind === 'deposit' ? 'in' : 'out'] += Number(entry.amount);
  }
  for (const expense of expenses) {
    // Paid from the USD account: its dollars, not the sums. Bar-side purchases always draw on the sums.
    if (reserveExpenseMethod(expense.payment_source, expense.payment_method) === 'usd') continue;
    if (inMonth(expense.date)) moves.out += Number(expense.amount);
  }
  return moves;
}

/**
 * Sums the reserve can turn into dollars through each Game Club method, as
 * exchange_owner_reserve limits a buy (170): what that method saved minus what
 * went back from it, never above the sums the reserve holds.
 */
export function reserveBuyLimits(
  entries: readonly ReserveLedgerEntry[],
  sumsHeld: number,
): Record<OwnerWithdrawalPaymentMethod, number> {
  const net: Record<OwnerWithdrawalPaymentMethod, number> = { cash: 0, terminal: 0, card: 0, playstation: 0 };
  for (const entry of entries) {
    if (entry.source !== 'game_club' || !entry.payment_method || entry.payment_method === 'usd') continue;
    net[entry.payment_method] += (entry.kind === 'deposit' ? 1 : -1) * Number(entry.amount);
  }
  const cap = Math.max(0, sumsHeld);
  return {
    cash: Math.max(0, Math.min(net.cash, cap)),
    terminal: Math.max(0, Math.min(net.terminal, cap)),
    card: Math.max(0, Math.min(net.card, cap)),
    playstation: Math.max(0, Math.min(net.playstation, cap)),
  };
}

export interface DollarRates {
  /** UZS per dollar of the latest exchange into or out of dollars; null when there was none. */
  lastRate: number | null;
  lastDate: string | null;
  /** UZS paid per dollar still held: their sums value over the dollars; null without dollars. */
  averageRate: number | null;
}

/** The rates behind the reserve's dollars: the latest one used and what the held dollars cost on average. */
export function reserveDollarRates(
  exchanges: readonly MoneyExchangeRow[],
  dollarsHeld: number,
  dollarsSumsValue: number,
): DollarRates {
  let last: MoneyExchangeRow | null = null;
  for (const row of exchanges) {
    if (row.rate === null || row.rate === undefined || (row.from_method !== 'usd' && row.to_method !== 'usd')) continue;
    if (!last || row.date > last.date || (row.date === last.date && (row.created_at ?? '') > (last.created_at ?? ''))) last = row;
  }
  return {
    lastRate: last ? Number(last.rate) : null,
    lastDate: last?.date ?? null,
    averageRate: dollarsHeld > 0 && dollarsSumsValue > 0 ? Math.round((dollarsSumsValue / dollarsHeld) * 100) / 100 : null,
  };
}

/** The sums the reserve holds as one pot (155): both sides, without the sums value of its dollars. */
export function reserveSumsHeld(balances: Record<OwnerWithdrawalSource, ReserveBalance>): number {
  return balances.game_club.held + balances.bar.held - balances.game_club.byMethod.usd;
}

/**
 * What the reserve held at the end of `date`, as the Reserve page counts it:
 * its sums as one pot (155) and the dollars of its USD account (143). Only
 * deposits, returns, purchases, exchanges and dollar expenses on or before
 * `date` count, so a later day's moves never show in an earlier day's figure.
 */
export function reserveHoldingsOn(
  reserve: {
    reserveEntries: readonly ReserveLedgerEntry[];
    reserveExpenses: readonly ReservePaidExpense[];
    exchangeRows: readonly MoneyExchangeRow[];
    dollarExpenses: readonly DollarExpenseRow[];
  },
  date: string,
): { sums: number; usd: number } {
  const onOrBefore = <T extends { date: string }>(rows: readonly T[]) => rows.filter((row) => row.date <= date);
  const balances = reserveBalances(
    reserve.reserveEntries.filter((entry) => reserveEntryDate(entry) <= date),
    onOrBefore(reserve.reserveExpenses),
  );
  return {
    sums: reserveSumsHeld(balances),
    usd: dollarsForMonth(onOrBefore(reserve.exchangeRows), date.slice(0, 7), onOrBefore(reserve.dollarExpenses)).heldUsd,
  };
}

/** What the reserve paid for, summed per expense category, in the order the categories first appear. */
export function reserveSpendingByCategory(activity: readonly ReserveActivity[]): Array<{ category: string; amount: number }> {
  const byCategory = new Map<string, number>();
  for (const row of activity) {
    if (row.kind === 'purchase') byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amount);
  }
  return [...byCategory.entries()].map(([category, amount]) => ({ category, amount }));
}

/** Everything put in, as what was spent, sent back to profit and is still held (never below zero). */
export function reserveFlowSplit(totals: ReserveFlow): { spent: number; returned: number; held: number } {
  return {
    spent: totals.spent,
    returned: totals.returned,
    held: Math.max(0, totals.deposited - totals.spent - totals.returned),
  };
}
