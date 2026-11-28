import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COLLECTED_METHODS,
  isCollectedMethod,
  parseCollectionBalances,
  type CollectedMethod,
} from '../../calculations/collectedMoney';

/**
 * The owner bot's money buttons, through the service-role wrappers of
 * migrations 192 and 193. Each call names the presser's Telegram id and a row
 * id from the button (or, for a typed amount, the question's message id); the
 * database finds the club, date, method and amount, checks that the linked
 * user owns the club, and acts as that user. Every call answers the day the
 * button belongs to, so the message can be redrawn.
 */

/** Which money a mark is about: a Game Club payment method, or the bar (no method). */
export type OwnerBotSide = 'game_club' | 'bar';
/** What the owner said happened to the money (owner_money_handovers.action). */
export type OwnerBotHandoverAction = 'collected' | 'reserve' | 'withdrawn' | 'left';
/** The choices a button can make: a Game Club method collected or reserved, the bar reserved or left. */
export type OwnerBotChoiceAction = 'collected' | 'reserve' | 'left';
/** What owner_bot_pick (193) is asked for. */
export type OwnerBotPickAction = OwnerBotChoiceAction | 'all_collected' | 'all_reserve';
/** What a typed amount can be for. */
export type OwnerBotAmountAction = 'collected' | 'reserve';

export interface OwnerBotHandover {
  id: string;
  side: OwnerBotSide;
  /** Null for the bar. */
  method: CollectedMethod | null;
  action: OwnerBotHandoverAction;
  amount: number;
  /** The marks of one "Всё…" confirmation share it; null otherwise. */
  groupId: string | null;
  createdAt: string;
  /** Until when the owner who made it may undo it from the bot. */
  undoUntil: string;
  /** Made by the user linked to this Telegram account. */
  mine: boolean;
}

/** One club's business day as the bot sees it, read as the owner. */
export interface OwnerBotDayState {
  clubId: string;
  clubName: string;
  businessDate: string;
  /** What is still in the admin's till per method on that day (get_collection_balances 'till'). */
  till: Record<CollectedMethod, number>;
  /** Marks of both sides not undone, oldest first. */
  handovers: OwnerBotHandover[];
  /** The button row of each method's line, for this Telegram account. */
  lineIds: Partial<Record<CollectedMethod, string>>;
  /** The day row (193): the bar line's button and the "Всё…" buttons. */
  dayId: string | null;
}

/** What a button row stands for (owner_bot_button and owner_bot_pick, 193). */
export type OwnerBotButtonKind = 'line' | 'choice' | 'day' | 'bar_choice' | 'all_choice' | 'amount_prompt';

export interface OwnerBotChoiceItem {
  method: CollectedMethod;
  amount: number;
}

export interface OwnerBotPendingButton {
  id: string;
  kind: OwnerBotButtonKind;
  side: OwnerBotSide;
  method: CollectedMethod | null;
  action: OwnerBotChoiceAction | null;
  amount: number | null;
  /** The methods and amounts of a "Всё…" choice, in the report's order. */
  items: OwnerBotChoiceItem[];
  /** A bar reserve smaller than the day's sales, because the month's bar profit allows no more. */
  capped: boolean;
  /** Past its time or already used; read only presses still redraw from it. */
  expired: boolean;
}

/** The question a "✏️ Другая сумма" press asked (owner_bot_ask_amount, owner_bot_answer_amount). */
export interface OwnerBotAmountPrompt {
  id: string;
  side: OwnerBotSide;
  method: CollectedMethod | null;
  action: OwnerBotAmountAction;
  /** The most the answer may be now (what the default would be). */
  maxAmount: number;
  /** The day message it was asked from, which the confirmation then replaces. */
  dayChatId: number | null;
  dayMessageId: number | null;
}

export interface OwnerBotActionResult {
  status: 'saved' | 'already_saved' | 'undone' | 'already_undone';
  handoverId: string;
  side: OwnerBotSide;
  /** Null for the bar and for a "Всё…" group. */
  method: CollectedMethod | null;
  action: OwnerBotHandoverAction;
  /** For a group, the sum of its marks. */
  amount: number;
  group: boolean;
}

export interface OwnerBotDayWithPending extends OwnerBotDayState {
  pending: OwnerBotPendingButton;
}

export interface OwnerBotDayWithResult extends OwnerBotDayState {
  result: OwnerBotActionResult;
}

export interface OwnerBotDayWithPrompt extends OwnerBotDayState {
  prompt: OwnerBotAmountPrompt;
}

/** The answer to a typed amount: a choice to confirm, or the question again. */
export type OwnerBotAmountAnswer =
  | ({ status: 'chosen' } & OwnerBotDayWithPending & { prompt: OwnerBotAmountPrompt })
  | { status: 'invalid' | 'too_large'; clubName: string; prompt: OwnerBotAmountPrompt };

/**
 * Why a press was refused, from the hint of the wrapper (192, 193) or of the
 * money RPC it called (146, 169, 097, 170). Each has its own reply.
 */
export type OwnerBotRefusal =
  | 'forbidden'
  | 'expired'
  | 'already_marked'
  | 'nothing_in_till'
  | 'nothing_in_bar'
  | 'bar_reserve_unavailable'
  | 'undo_expired'
  | 'cannot_undo'
  | 'till_short'
  | 'reserve_exceeds_available'
  | 'day_closed'
  | 'already_spent';

const REFUSAL_BY_HINT: Readonly<Record<string, OwnerBotRefusal>> = {
  owner_bot_not_linked: 'forbidden',
  owner_bot_not_owner: 'forbidden',
  owner_bot_forbidden: 'forbidden',
  owner_bot_expired: 'expired',
  owner_bot_already_marked: 'already_marked',
  owner_bot_nothing_in_till: 'nothing_in_till',
  owner_bot_nothing_in_bar: 'nothing_in_bar',
  owner_bot_bar_reserve_unavailable: 'bar_reserve_unavailable',
  owner_bot_undo_expired: 'undo_expired',
  owner_bot_cannot_undo: 'cannot_undo',
  INSUFFICIENT_BALANCE: 'till_short',
  reserve_exceeds_available: 'reserve_exceeds_available',
  day_collected: 'day_closed',
  COLLECTED_INSUFFICIENT: 'already_spent',
  reserve_already_used: 'already_spent',
};

interface DatabaseError {
  code?: string | null;
  hint?: string | null;
  message?: string | null;
}

/** A refused press, carrying the database error it came from. */
export class OwnerBotActionError extends Error {
  readonly refusal: OwnerBotRefusal | null;
  readonly code: string | null;
  readonly hint: string | null;

  constructor(error: DatabaseError) {
    super(error.message || 'Owner bot action failed');
    this.name = 'OwnerBotActionError';
    this.code = error.code ?? null;
    this.hint = error.hint ?? null;
    this.refusal = ownerBotRefusal(error);
  }
}

/** The refusal behind a database error, or null when it is not one the owner can act on (a failure). */
export function ownerBotRefusal(error: DatabaseError | null | undefined): OwnerBotRefusal | null {
  if (!error) return null;
  const byHint = error.hint ? REFUSAL_BY_HINT[error.hint] : undefined;
  if (byHint) return byHint;
  // Any other access refusal (42501) is still "no access", never a retry.
  return error.code === '42501' ? 'forbidden' : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const whole = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const idOrNull = (value: unknown) => (typeof value === 'string' && value ? value : null);
const positiveOrNull = (value: unknown) => {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isSafeInteger(number) && number > 0 ? number : null;
};

function isSide(value: unknown): value is OwnerBotSide {
  return value === 'game_club' || value === 'bar';
}

function isHandoverAction(value: unknown): value is OwnerBotHandoverAction {
  return value === 'collected' || value === 'reserve' || value === 'withdrawn' || value === 'left';
}

function isChoiceAction(value: unknown): value is OwnerBotChoiceAction {
  return value === 'collected' || value === 'reserve' || value === 'left';
}

const BUTTON_KINDS: readonly OwnerBotButtonKind[] = ['line', 'choice', 'day', 'bar_choice', 'all_choice', 'amount_prompt'];

function invalid(): never {
  throw new Error('The owner bot day payload has an unexpected shape');
}

/** A mark of a side with the method that side needs (the bar has none). */
function parseHandover(row: Record<string, unknown>): OwnerBotHandover | null {
  if (!isSide(row.side) || !isHandoverAction(row.action)) return null;
  const method = row.side === 'game_club' ? (isCollectedMethod(row.payment_method) ? row.payment_method : null) : null;
  if (row.side === 'game_club' && method === null) return null;
  return {
    id: text(row.id),
    side: row.side,
    method,
    action: row.action,
    amount: whole(row.amount),
    groupId: idOrNull(row.group_id),
    createdAt: text(row.created_at),
    undoUntil: text(row.undo_until),
    mine: row.mine === true,
  };
}

export function parseOwnerBotDayState(value: unknown): OwnerBotDayState {
  if (!isRecord(value) || typeof value.club_id !== 'string' || typeof value.business_date !== 'string') invalid();
  const balances = parseCollectionBalances(value.balances);
  if (!balances) invalid();
  const till = Object.fromEntries(COLLECTED_METHODS.map((method) => [method, balances[method].till])) as Record<CollectedMethod, number>;

  const handovers = (Array.isArray(value.handovers) ? value.handovers : [])
    .filter(isRecord)
    .map(parseHandover)
    .filter((handover): handover is OwnerBotHandover => handover !== null);

  const lineIds: Partial<Record<CollectedMethod, string>> = {};
  if (isRecord(value.lines)) {
    for (const method of COLLECTED_METHODS) {
      const id = value.lines[method];
      if (typeof id === 'string') lineIds[method] = id;
    }
  }

  return {
    clubId: value.club_id,
    clubName: text(value.club_name) || '—',
    businessDate: value.business_date.slice(0, 10),
    till,
    handovers,
    lineIds,
    dayId: idOrNull(value.day_id),
  };
}

function parseItems(value: unknown): OwnerBotChoiceItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((item) => (isCollectedMethod(item.payment_method)
    ? [{ method: item.payment_method, amount: whole(item.amount) }]
    : []));
}

function parsePending(value: unknown): OwnerBotPendingButton {
  if (!isRecord(value) || typeof value.id !== 'string') invalid();
  const kind = (BUTTON_KINDS as readonly unknown[]).includes(value.kind) ? value.kind as OwnerBotButtonKind : null;
  const side = isSide(value.side) ? value.side : null;
  if (!kind || !side) invalid();
  const method = isCollectedMethod(value.payment_method) ? value.payment_method : null;
  if ((kind === 'line' || kind === 'choice') && method === null) invalid();
  return {
    id: value.id,
    kind,
    side,
    method,
    action: isChoiceAction(value.action) ? value.action : null,
    amount: value.amount === null || value.amount === undefined ? null : whole(value.amount),
    items: parseItems(value.items),
    capped: value.capped === true,
    expired: value.expired === true,
  };
}

function parsePrompt(value: unknown): OwnerBotAmountPrompt {
  if (!isRecord(value) || typeof value.id !== 'string' || !isSide(value.side)
    || (value.action !== 'collected' && value.action !== 'reserve')) invalid();
  const method = isCollectedMethod(value.payment_method) ? value.payment_method : null;
  if (value.side === 'game_club' && method === null) invalid();
  return {
    id: value.id,
    side: value.side,
    method,
    action: value.action,
    maxAmount: whole(value.max_amount),
    dayChatId: positiveOrNull(value.day_chat_id),
    dayMessageId: positiveOrNull(value.day_message_id),
  };
}

const RESULT_STATUSES = ['saved', 'already_saved', 'undone', 'already_undone'] as const;

function parseResult(value: unknown): OwnerBotActionResult {
  if (!isRecord(value) || !(RESULT_STATUSES as readonly unknown[]).includes(value.status)
    || !isHandoverAction(value.action)) invalid();
  const side = isSide(value.side) ? value.side : 'game_club';
  const group = value.group === true;
  const method = isCollectedMethod(value.payment_method) ? value.payment_method : null;
  if (side === 'game_club' && !group && method === null) invalid();
  return {
    status: value.status as OwnerBotActionResult['status'],
    handoverId: text(value.handover_id),
    side,
    method,
    action: value.action,
    amount: whole(value.amount),
    group,
  };
}

async function call(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new OwnerBotActionError(error);
  if (!isRecord(data)) invalid();
  return data;
}

/** The /today (and morning) state of one club and business day: lines, the day row and the marks. */
export async function openOwnerBotDay(
  supabase: SupabaseClient,
  { telegramUserId, clubId, businessDate }: { telegramUserId: number; clubId: string; businessDate: string },
): Promise<OwnerBotDayState> {
  return parseOwnerBotDayState(await call(supabase, 'owner_bot_today', {
    p_telegram_user_id: telegramUserId,
    p_club_id: clubId,
    p_date: businessDate,
  }));
}

/**
 * Read only: the day a button of either table belongs to and the button's
 * own row, also when it has expired (✖️ Нет, ⬅️ Назад and the submenus).
 */
export async function readOwnerBotButton(supabase: SupabaseClient, telegramUserId: number, id: string): Promise<OwnerBotDayWithPending> {
  const data = await call(supabase, 'owner_bot_button', { p_telegram_user_id: telegramUserId, p_id: id });
  return { ...parseOwnerBotDayState(data), pending: parsePending(data.pending) };
}

/** A new choice with the amount fixed now; nothing is saved until ✅ Да. */
export async function pickOwnerBotAction(
  supabase: SupabaseClient,
  telegramUserId: number,
  id: string,
  action: OwnerBotPickAction,
): Promise<OwnerBotDayWithPending> {
  const data = await call(supabase, 'owner_bot_pick', { p_telegram_user_id: telegramUserId, p_id: id, p_action: action });
  return { ...parseOwnerBotDayState(data), pending: parsePending(data.pending) };
}

/** ✏️ Другая сумма: a question for this line or the bar, remembering the day message it came from. */
export async function askOwnerBotAmount(
  supabase: SupabaseClient,
  { telegramUserId, id, action, chatId, messageId }: {
    telegramUserId: number;
    id: string;
    action: OwnerBotAmountAction;
    chatId: number | null;
    messageId: number | null;
  },
): Promise<OwnerBotDayWithPrompt> {
  const data = await call(supabase, 'owner_bot_ask_amount', {
    p_telegram_user_id: telegramUserId,
    p_id: id,
    p_action: action,
    p_chat_id: chatId,
    p_message_id: messageId,
  });
  return { ...parseOwnerBotDayState(data), prompt: parsePrompt(data.prompt) };
}

/** The ForceReply message a question was sent as; the owner's reply is matched by it. */
export async function recordOwnerBotPrompt(
  supabase: SupabaseClient,
  { telegramUserId, promptId, promptMessageId }: { telegramUserId: number; promptId: string; promptMessageId: number },
): Promise<void> {
  const { error } = await supabase.rpc('owner_bot_prompt_sent', {
    p_telegram_user_id: telegramUserId,
    p_prompt_id: promptId,
    p_prompt_message_id: promptMessageId,
  });
  if (error) throw new OwnerBotActionError(error);
}

/** The owner's typed amount (null when it was not a sum), for the question sent as that message. */
export async function answerOwnerBotAmount(
  supabase: SupabaseClient,
  { telegramUserId, promptMessageId, amount }: { telegramUserId: number; promptMessageId: number; amount: number | null },
): Promise<OwnerBotAmountAnswer> {
  const data = await call(supabase, 'owner_bot_answer_amount', {
    p_telegram_user_id: telegramUserId,
    p_prompt_message_id: promptMessageId,
    p_amount: amount,
  });
  const prompt = parsePrompt(data.prompt);
  if (data.status === 'chosen') {
    return { status: 'chosen', ...parseOwnerBotDayState(data), pending: parsePending(data.pending), prompt };
  }
  if (data.status !== 'invalid' && data.status !== 'too_large') invalid();
  return { status: data.status, clubName: text(data.club_name) || '—', prompt };
}

/** ✅ Да: saves the choice once; a repeated press answers already_saved. */
export async function confirmOwnerBotAction(
  supabase: SupabaseClient,
  { telegramUserId, choiceId, chatId, messageId }: { telegramUserId: number; choiceId: string; chatId: number | null; messageId: number | null },
): Promise<OwnerBotDayWithResult> {
  const data = await call(supabase, 'owner_bot_confirm_any', {
    p_telegram_user_id: telegramUserId,
    p_choice_id: choiceId,
    p_chat_id: chatId,
    p_message_id: messageId,
  });
  return { ...parseOwnerBotDayState(data), result: parseResult(data.result) };
}

/** ↩️ Отменить: within 10 minutes, by the owner who saved it; a "Всё…" group as a whole. */
export async function undoOwnerBotAction(supabase: SupabaseClient, telegramUserId: number, handoverId: string): Promise<OwnerBotDayWithResult> {
  const data = await call(supabase, 'owner_bot_undo_any', { p_telegram_user_id: telegramUserId, p_handover_id: handoverId });
  return { ...parseOwnerBotDayState(data), result: parseResult(data.result) };
}
