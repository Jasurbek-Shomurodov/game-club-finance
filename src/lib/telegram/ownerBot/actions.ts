import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COLLECTED_METHODS,
  isCollectedMethod,
  parseCollectionBalances,
  type CollectedMethod,
} from '../../calculations/collectedMoney';

/**
 * The owner bot's money buttons, through the service-role wrappers of
 * migration 192. Each call names the presser's Telegram id and a row id from
 * the button; the database finds the club, date, method and amount, checks
 * that the linked user owns the club, and acts as that user. Every call
 * answers the day the button belongs to, so the message can be redrawn.
 */

/** What the owner said happened to a method's money (owner_money_handovers.action, Game Club side). */
export type OwnerBotHandoverAction = 'collected' | 'reserve' | 'withdrawn';
/** The two a button can make in this slice. */
export type OwnerBotChoiceAction = 'collected' | 'reserve';

export interface OwnerBotHandover {
  id: string;
  method: CollectedMethod;
  action: OwnerBotHandoverAction;
  amount: number;
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
  /** Game Club marks not undone, oldest first. */
  handovers: OwnerBotHandover[];
  /** The button row of each method's line, for this Telegram account. */
  lineIds: Partial<Record<CollectedMethod, string>>;
}

/** The button row a press named: a line (action null) or a choice waiting for ✅ Да. */
export interface OwnerBotPendingButton {
  id: string;
  method: CollectedMethod;
  action: OwnerBotChoiceAction | null;
  amount: number | null;
}

export interface OwnerBotActionResult {
  status: 'saved' | 'already_saved' | 'undone' | 'already_undone';
  handoverId: string;
  method: CollectedMethod;
  action: OwnerBotHandoverAction;
  amount: number;
}

export interface OwnerBotDayWithPending extends OwnerBotDayState {
  pending: OwnerBotPendingButton;
}

export interface OwnerBotDayWithResult extends OwnerBotDayState {
  result: OwnerBotActionResult;
}

/**
 * Why a press was refused, from the hint of the wrapper (192) or of the
 * money RPC it called (146, 169, 097, 170). Each has its own reply.
 */
export type OwnerBotRefusal =
  | 'forbidden'
  | 'expired'
  | 'already_marked'
  | 'nothing_in_till'
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

function isHandoverAction(value: unknown): value is OwnerBotHandoverAction {
  return value === 'collected' || value === 'reserve' || value === 'withdrawn';
}

function isChoiceAction(value: unknown): value is OwnerBotChoiceAction {
  return value === 'collected' || value === 'reserve';
}

function invalid(): never {
  throw new Error('The owner bot day payload has an unexpected shape');
}

export function parseOwnerBotDayState(value: unknown): OwnerBotDayState {
  if (!isRecord(value) || typeof value.club_id !== 'string' || typeof value.business_date !== 'string') invalid();
  const balances = parseCollectionBalances(value.balances);
  if (!balances) invalid();
  const till = Object.fromEntries(COLLECTED_METHODS.map((method) => [method, balances[method].till])) as Record<CollectedMethod, number>;

  const handovers = (Array.isArray(value.handovers) ? value.handovers : [])
    .filter(isRecord)
    // Bar marks arrive with slice 4; this message shows Game Club methods only.
    .filter((row) => row.side === 'game_club' && isCollectedMethod(row.payment_method) && isHandoverAction(row.action))
    .map((row): OwnerBotHandover => ({
      id: text(row.id),
      method: row.payment_method as CollectedMethod,
      action: row.action as OwnerBotHandoverAction,
      amount: whole(row.amount),
      createdAt: text(row.created_at),
      undoUntil: text(row.undo_until),
      mine: row.mine === true,
    }));

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
  };
}

function parsePending(value: unknown): OwnerBotPendingButton {
  if (!isRecord(value) || typeof value.id !== 'string' || !isCollectedMethod(value.payment_method)) invalid();
  return {
    id: value.id,
    method: value.payment_method,
    action: isChoiceAction(value.action) ? value.action : null,
    amount: value.amount === null || value.amount === undefined ? null : whole(value.amount),
  };
}

const RESULT_STATUSES = ['saved', 'already_saved', 'undone', 'already_undone'] as const;

function parseResult(value: unknown): OwnerBotActionResult {
  if (!isRecord(value) || !(RESULT_STATUSES as readonly unknown[]).includes(value.status)
    || !isCollectedMethod(value.payment_method) || !isHandoverAction(value.action)) invalid();
  return {
    status: value.status as OwnerBotActionResult['status'],
    handoverId: text(value.handover_id),
    method: value.payment_method,
    action: value.action,
    amount: whole(value.amount),
  };
}

async function call(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new OwnerBotActionError(error);
  if (!isRecord(data)) invalid();
  return data;
}

/** The /today state of one club and business day, with a line id per method. */
export async function openOwnerBotDay(
  supabase: SupabaseClient,
  { telegramUserId, clubId, businessDate }: { telegramUserId: number; clubId: string; businessDate: string },
): Promise<OwnerBotDayState> {
  return parseOwnerBotDayState(await call(supabase, 'owner_bot_open_day', {
    p_telegram_user_id: telegramUserId,
    p_club_id: clubId,
    p_date: businessDate,
  }));
}

/** The day a button belongs to, and the button's own row (menu, back, no). */
export async function readOwnerBotPending(supabase: SupabaseClient, telegramUserId: number, id: string): Promise<OwnerBotDayWithPending> {
  const data = await call(supabase, 'owner_bot_pending', { p_telegram_user_id: telegramUserId, p_id: id });
  return { ...parseOwnerBotDayState(data), pending: parsePending(data.pending) };
}

/** A new choice for what is still in the till now; nothing is saved until ✅ Да. */
export async function chooseOwnerBotAction(
  supabase: SupabaseClient,
  telegramUserId: number,
  lineId: string,
  action: OwnerBotChoiceAction,
): Promise<OwnerBotDayWithPending> {
  const data = await call(supabase, 'owner_bot_choose', { p_telegram_user_id: telegramUserId, p_line_id: lineId, p_action: action });
  return { ...parseOwnerBotDayState(data), pending: parsePending(data.pending) };
}

/** ✅ Да: saves the choice once; a repeated press answers already_saved. */
export async function confirmOwnerBotAction(
  supabase: SupabaseClient,
  { telegramUserId, choiceId, chatId, messageId }: { telegramUserId: number; choiceId: string; chatId: number | null; messageId: number | null },
): Promise<OwnerBotDayWithResult> {
  const data = await call(supabase, 'owner_bot_confirm', {
    p_telegram_user_id: telegramUserId,
    p_choice_id: choiceId,
    p_chat_id: chatId,
    p_message_id: messageId,
  });
  return { ...parseOwnerBotDayState(data), result: parseResult(data.result) };
}

/** ↩️ Отменить: within 10 minutes, by the owner who saved it. */
export async function undoOwnerBotAction(supabase: SupabaseClient, telegramUserId: number, handoverId: string): Promise<OwnerBotDayWithResult> {
  const data = await call(supabase, 'owner_bot_undo', { p_telegram_user_id: telegramUserId, p_handover_id: handoverId });
  return { ...parseOwnerBotDayState(data), result: parseResult(data.result) };
}
