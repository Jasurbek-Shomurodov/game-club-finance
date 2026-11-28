import { COLLECTED_METHODS, type CollectedMethod } from '../../calculations/collectedMoney';
import { DAY_METHOD_ORDER } from '../dailyFinanceReport';
import type { OwnerBotDayState, OwnerBotHandover, OwnerBotHandoverAction, OwnerBotSide } from './actions';
import type { OwnerBotDay } from './texts';

/**
 * What one club's owner bot message shows: per Game Club method the money
 * and its state, the bar line, which lines still get a button, the "Всё…"
 * buttons and the one undo button. Pure: the day's figures (day.ts) and the
 * database state (actions.ts) in, the message's contents out.
 */

/**
 * open: there is money and nothing is marked (has a button).
 * empty: nothing is marked and there is no money (no button).
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

export interface OwnerBotBarLine {
  status: OwnerBotLineStatus;
  /** The day's bar sales. */
  sales: number;
  /** What the mark moved (the sales while unmarked). */
  amount: number;
  /** The day row, only while the line is open. */
  buttonId: string | null;
}

export interface OwnerBotUndo {
  handoverId: string;
  side: OwnerBotSide;
  /** Null for the bar and for a "Всё…" group. */
  method: CollectedMethod | null;
  action: OwnerBotHandoverAction;
  group: boolean;
}

export interface OwnerBotDayView {
  clubName: string;
  businessDate: string;
  lines: OwnerBotLine[];
  bar: OwnerBotBarLine;
  /** The day row for ✅ Всё забрал / 🏦 Всё в резерв, while two or more methods are open. */
  allButtonId: string | null;
  /** Everything still in the admin's till that day, all methods. */
  tillTotal: number;
  undo: OwnerBotUndo | null;
}

/** "Всё…" is offered only when it saves taps: with one open method its own button does the same. */
const MIN_OPEN_LINES_FOR_ALL = 2;

function latest(handovers: readonly OwnerBotHandover[]): OwnerBotHandover | undefined {
  return [...handovers].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
}

const total = (handovers: readonly OwnerBotHandover[]) => handovers.reduce((sum, mark) => sum + mark.amount, 0);

export function buildOwnerBotDayView(day: OwnerBotDay, state: OwnerBotDayState, now: Date): OwnerBotDayView {
  const dayNet = new Map(day.methods.map((item) => [item.method, item.net]));
  const tillOf = (method: CollectedMethod) => Math.max(0, Math.floor(state.till[method] ?? 0));
  const gameMarks = state.handovers.filter((handover) => handover.side === 'game_club');
  const marksOf = (method: CollectedMethod) => gameMarks.filter((handover) => handover.method === method);

  // The report's methods, and any other one that still has money in the till or a mark, so nothing is hidden.
  const methods = DAY_METHOD_ORDER.filter((method) => dayNet.has(method) || tillOf(method) > 0 || marksOf(method).length > 0);

  const lines = methods.map((method): OwnerBotLine => {
    const marks = marksOf(method);
    const last = latest(marks);
    const net = dayNet.get(method) ?? 0;
    if (last) return { method, status: last.action, amount: total(marks), dayNet: net, buttonId: null };
    const till = tillOf(method);
    const buttonId = till > 0 ? state.lineIds[method] ?? null : null;
    return { method, status: till > 0 ? 'open' : 'empty', amount: till, dayNet: net, buttonId };
  });

  const barMarks = state.handovers.filter((handover) => handover.side === 'bar');
  const lastBar = latest(barMarks);
  const sales = Math.max(0, Math.floor(day.barSales));
  const bar: OwnerBotBarLine = lastBar
    ? { status: lastBar.action, sales, amount: total(barMarks), buttonId: null }
    : { status: sales > 0 ? 'open' : 'empty', sales, amount: sales, buttonId: sales > 0 ? state.dayId : null };

  const openLines = lines.filter((line) => line.status === 'open').length;
  const lastOwn = latest(state.handovers.filter((handover) => handover.mine));
  const undoUntil = lastOwn ? Date.parse(lastOwn.undoUntil) : Number.NaN;
  return {
    clubName: state.clubName,
    businessDate: state.businessDate,
    lines,
    bar,
    allButtonId: openLines >= MIN_OPEN_LINES_FOR_ALL ? state.dayId : null,
    tillTotal: COLLECTED_METHODS.reduce((sum, method) => sum + tillOf(method), 0),
    undo: lastOwn && undoUntil > now.getTime()
      ? {
          handoverId: lastOwn.id,
          side: lastOwn.side,
          method: lastOwn.groupId ? null : lastOwn.method,
          action: lastOwn.action,
          group: lastOwn.groupId !== null,
        }
      : null,
  };
}

/** The line of a method, when the message shows it. */
export function ownerBotLine(view: OwnerBotDayView, method: CollectedMethod): OwnerBotLine | undefined {
  return view.lines.find((line) => line.method === method);
}
