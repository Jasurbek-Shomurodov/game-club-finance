import { COLLECTED_METHODS, type CollectedMethod } from '../../calculations/collectedMoney';
import { DAY_METHOD_ORDER } from '../dailyFinanceReport';
import type { OwnerBotDayState, OwnerBotHandover, OwnerBotHandoverAction } from './actions';
import type { OwnerBotDay } from './texts';

/**
 * What one club's owner bot message shows: per Game Club method the money
 * and its state, which lines still get a button, and the one undo button.
 * Pure: the day's figures (day.ts) and the database state (actions.ts) in,
 * the message's contents out.
 */

/**
 * open: money is in the till and nothing is marked (has a button).
 * empty: nothing is marked and the till holds none of it (no button).
 * Otherwise the latest mark not undone.
 */
export type OwnerBotLineStatus = 'open' | 'empty' | OwnerBotHandoverAction;

export interface OwnerBotLine {
  method: CollectedMethod;
  status: OwnerBotLineStatus;
  /** The till for an unmarked line, what the marks moved for a marked one; whole sums. */
  amount: number;
  /** The day's own figure for the method (the report's "Оплаты за день" net). */
  dayNet: number;
  /** The line's button row, only while it is open (null too when the database gave none). */
  buttonId: string | null;
}

export interface OwnerBotUndo {
  handoverId: string;
  method: CollectedMethod;
  action: OwnerBotHandoverAction;
}

export interface OwnerBotDayView {
  clubName: string;
  businessDate: string;
  lines: OwnerBotLine[];
  barSales: number;
  /** Everything still in the admin's till that day, all methods. */
  tillTotal: number;
  undo: OwnerBotUndo | null;
}

function latest(handovers: readonly OwnerBotHandover[]): OwnerBotHandover | undefined {
  return [...handovers].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
}

export function buildOwnerBotDayView(day: OwnerBotDay, state: OwnerBotDayState, now: Date): OwnerBotDayView {
  const dayNet = new Map(day.methods.map((item) => [item.method, item.net]));
  const tillOf = (method: CollectedMethod) => Math.max(0, Math.floor(state.till[method] ?? 0));
  const marksOf = (method: CollectedMethod) => state.handovers.filter((handover) => handover.method === method);

  // The report's methods, and any other one that still has money in the till or a mark, so nothing is hidden.
  const methods = DAY_METHOD_ORDER.filter((method) => dayNet.has(method) || tillOf(method) > 0 || marksOf(method).length > 0);

  const lines = methods.map((method): OwnerBotLine => {
    const marks = marksOf(method);
    const last = latest(marks);
    const net = dayNet.get(method) ?? 0;
    if (last) {
      return { method, status: last.action, amount: marks.reduce((total, mark) => total + mark.amount, 0), dayNet: net, buttonId: null };
    }
    const till = tillOf(method);
    const buttonId = till > 0 ? state.lineIds[method] ?? null : null;
    return { method, status: till > 0 ? 'open' : 'empty', amount: till, dayNet: net, buttonId };
  });

  const lastOwn = latest(state.handovers.filter((handover) => handover.mine));
  const undoUntil = lastOwn ? Date.parse(lastOwn.undoUntil) : Number.NaN;
  return {
    clubName: state.clubName,
    businessDate: state.businessDate,
    lines,
    barSales: day.barSales,
    tillTotal: COLLECTED_METHODS.reduce((total, method) => total + tillOf(method), 0),
    undo: lastOwn && undoUntil > now.getTime()
      ? { handoverId: lastOwn.id, method: lastOwn.method, action: lastOwn.action }
      : null,
  };
}

/** The line of a method, when the message shows it. */
export function ownerBotLine(view: OwnerBotDayView, method: CollectedMethod): OwnerBotLine | undefined {
  return view.lines.find((line) => line.method === method);
}
