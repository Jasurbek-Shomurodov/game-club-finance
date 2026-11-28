/**
 * The owner bot's button data: `v1:<action>:<id>`, at most Telegram's 64
 * bytes. The id names a row of migration 192 or 193 (a line or choice of
 * owner_bot_pending_actions, a day or choice row of owner_bot_steps, or a
 * handover for undo); the club, date, method and amount are read from that
 * row, never from the button.
 */

/** Telegram's limit for callback_data, in bytes. */
export const CALLBACK_DATA_MAX_BYTES = 64;

export const OWNER_BOT_CALLBACK_ACTIONS = [
  /** A method's line or the bar line: open its submenu. Id: line row, or the day row for the bar. */
  'menu',
  /** ✅ Забрал in a method's submenu. Id: line row. */
  'collect',
  /** 🏦 В резерв in a submenu. Id: line row, or the day row for the bar. */
  'reserve',
  /** 👌 Оставил в баре in the bar's submenu. Id: day row. */
  'left',
  /** ✏️ Другая сумма in a method's submenu: choose what the part is for. Id: line row. */
  'amount',
  /** ✏️ … ✅ Забрал: ask how much was collected. Id: line row. */
  'askcollect',
  /** ✏️ … 🏦 В резерв: ask how much went into the reserve. Id: line row, or the day row for the bar. */
  'askreserve',
  /** ✅ Всё забрал on the day message. Id: day row. */
  'allcollect',
  /** 🏦 Всё в резерв on the day message. Id: day row. */
  'allreserve',
  /** ⬅️ Назад: back to the day. Id: any button row. */
  'back',
  /** ✅ Да on a confirmation. Id: choice row (either table). */
  'yes',
  /** ✖️ Нет on a confirmation: back to the day. Id: choice row (either table). */
  'no',
  /** ↩️ Отменить. Id: handover. */
  'undo',
] as const;
export type OwnerBotCallbackAction = (typeof OWNER_BOT_CALLBACK_ACTIONS)[number];

export interface OwnerBotCallbackData {
  action: OwnerBotCallbackAction;
  id: string;
}

const VERSION = 'v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isAction(value: string): value is OwnerBotCallbackAction {
  return (OWNER_BOT_CALLBACK_ACTIONS as readonly string[]).includes(value);
}

export function buildOwnerBotCallbackData(action: OwnerBotCallbackAction, id: string): string {
  const normalized = id.toLowerCase();
  if (!UUID.test(normalized)) throw new Error('Owner bot buttons carry a row id');
  const data = `${VERSION}:${action}:${normalized}`;
  if (new TextEncoder().encode(data).length > CALLBACK_DATA_MAX_BYTES) throw new Error('Owner bot button data is too long');
  return data;
}

/** The button a press stands for, or null for data this version did not make (an old or forged button). */
export function parseOwnerBotCallbackData(data: unknown): OwnerBotCallbackData | null {
  if (typeof data !== 'string' || data.length > CALLBACK_DATA_MAX_BYTES) return null;
  const [version, action, id, ...rest] = data.split(':');
  if (version !== VERSION || rest.length > 0 || !action || !id) return null;
  if (!isAction(action) || !UUID.test(id)) return null;
  return { action, id };
}
