/**
 * What the Reports entry sheet shows about one income entry's money by
 * payment method, and which reserve actions an owner gets on it. Pure, so the
 * sheet only renders the answer.
 */
import type { MoneyReportActivity } from './moneyReport';
import type { ReserveDepositAmounts } from './ownerReserve';
import type { CollectedMoneyMove } from './collectedMoney';
import { reservedNetBy, type ReserveMove } from './reserveMoves';
import { OWNER_WITHDRAWAL_PAYMENT_METHODS, type OwnerWithdrawalPaymentMethod } from '@/types';

/** One payment method of a split entry, as the sheet lists it. */
export interface EntryMethodRow {
  method: OwnerWithdrawalPaymentMethod;
  amount: number;
  /** Share of the entry's positive money, 0..1; 0 for a negative part (it gets no bar). */
  share: number;
}

/** The methods of a split entry that moved money, in the app's method order, with their share of what came in. */
export function entryMethodRows(breakdown: MoneyReportActivity['paymentBreakdown']): EntryMethodRow[] {
  if (!breakdown) return [];
  const amounts = OWNER_WITHDRAWAL_PAYMENT_METHODS.map((method) => {
    const amount = Number(breakdown[method] ?? 0);
    return { method, amount: Number.isFinite(amount) ? amount : 0 };
  });
  const positive = amounts.reduce((sum, part) => sum + Math.max(part.amount, 0), 0);
  return amounts
    .filter((part) => part.amount !== 0)
    .map((part) => ({ ...part, share: part.amount > 0 && positive > 0 ? part.amount / positive : 0 }));
}

/**
 * The reserve actions an entry sheet offers:
 * - `none`: nothing (not an owner, not a Game Club income entry, or no money came in);
 * - `open`: one action per method that brought money in, and one for all of them.
 *
 * A ticked (closed) day gets the actions too: since 169 the tick only closes
 * the day, money leaves the till only through Collect, and the deposit form's
 * till cap decides what can still move.
 */
export type EntryReserveActions =
  | { kind: 'none' }
  | { kind: 'open'; methods: OwnerWithdrawalPaymentMethod[]; all: ReserveDepositAmounts };

/** A Game Club income entry: the day's cash entry, split by method. */
export function isGameClubIncomeEntry(activity: MoneyReportActivity): boolean {
  return activity.kind === 'income' && activity.source === 'daily_cash' && Boolean(activity.paymentBreakdown);
}

export function entryReserveActions({ canMoveToReserve, activity }: {
  /** Only an owner moves money into the reserve. */
  canMoveToReserve: boolean;
  activity: MoneyReportActivity;
}): EntryReserveActions {
  if (!canMoveToReserve || !isGameClubIncomeEntry(activity)) return { kind: 'none' };
  const parts = entryMethodRows(activity.paymentBreakdown)
    .filter((row) => row.amount > 0)
    .map((row) => ({ method: row.method, amount: Math.floor(row.amount) }))
    .filter((part) => part.amount > 0);
  if (parts.length === 0) return { kind: 'none' };
  return {
    kind: 'open',
    methods: parts.map((part) => part.method),
    all: Object.fromEntries(parts.map((part) => [part.method, part.amount])) as ReserveDepositAmounts,
  };
}

/** What a method's own reserve action starts the deposit form from: that method's part only. */
export function entryMethodReserveAmounts(
  actions: EntryReserveActions,
  method: OwnerWithdrawalPaymentMethod,
): ReserveDepositAmounts | null {
  if (actions.kind !== 'open') return null;
  const amount = actions.all[method];
  return amount && amount > 0 ? { [method]: amount } : null;
}

/**
 * Game Club till money that went into the reserve on a day, net: deposits less
 * returns, as `reservedNetBy` counts it, so an exchange inside the reserve (170,
 * a return and a dollar buy, or a dollar sale and a deposit, on one day) cancels
 * out. Deposits made from collected money (169) did not leave that day's till,
 * so they are taken off. Never below zero: a day that returned more shows nothing.
 */
export function reservedFromGameClubOn(
  moves: readonly ReserveMove[],
  date: string,
  collectedMoves: readonly Pick<CollectedMoneyMove, 'kind' | 'date' | 'amount'>[] = [],
): number {
  const net = reservedNetBy(moves.filter((move) => move.date === date), 'game_club');
  const fromCollected = collectedMoves.reduce((sum, move) => (
    move.kind === 'reserve' && move.date === date ? sum + Math.abs(move.amount) : sum
  ), 0);
  return Math.max(0, net - fromCollected);
}
