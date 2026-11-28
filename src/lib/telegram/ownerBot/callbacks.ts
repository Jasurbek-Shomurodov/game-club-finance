import type { SupabaseClient } from '@supabase/supabase-js';
import {
  OwnerBotActionError,
  askOwnerBotAmount,
  confirmOwnerBotAction,
  pickOwnerBotAction,
  readOwnerBotButton,
  undoOwnerBotAction,
  type OwnerBotDayState,
  type OwnerBotDayWithResult,
  type OwnerBotPendingButton,
  type OwnerBotPickAction,
  type OwnerBotRefusal,
} from './actions';
import { parseOwnerBotCallbackData, type OwnerBotCallbackAction } from './callbackData';
import { fetchOwnerBotDayOn } from './day';
import { buildOwnerBotDayView, ownerBotLine, type OwnerBotDayView } from './dayView';
import {
  amountMenuKeyboard,
  barMenuKeyboard,
  confirmKeyboard,
  dayKeyboard,
  methodMenuKeyboard,
  type OwnerBotKeyboard,
} from './keyboard';
import {
  amountMenuText,
  amountPromptText,
  amountPromptToastText,
  barMenuText,
  confirmText,
  dayText,
  methodMenuText,
  pressFailedText,
  refusalText,
  resultToastText,
  type OwnerBotConfirmChoice,
} from './texts';
import type { OwnerBotCallbackQuery } from './update';

/**
 * Answers one press of an owner bot button: the toast or alert, how the
 * message is redrawn, and for ✏️ Другая сумма the question to send. Every
 * press goes through a migration 192/193 wrapper, which checks again that
 * the presser's linked user owns the club; nothing the button carries but a
 * row id is trusted.
 */

export interface OwnerBotMessageEdit {
  text: string;
  keyboard: OwnerBotKeyboard | null;
}

/** A question to send as a new ForceReply message, then record (owner_bot_prompt_sent). */
export interface OwnerBotPromptToSend {
  promptId: string;
  text: string;
}

export interface OwnerBotCallbackReply {
  answer: { text: string; showAlert: boolean };
  /** Null: leave the message as it is. */
  edit: OwnerBotMessageEdit | null;
  prompt?: OwnerBotPromptToSend | null;
}

const silent = { text: '', showAlert: false };

const refused = (refusal: OwnerBotRefusal, edit: OwnerBotMessageEdit | null = null): OwnerBotCallbackReply => ({
  answer: { text: refusalText(refusal), showAlert: true },
  edit,
});

const dayEdit = (view: OwnerBotDayView): OwnerBotMessageEdit => ({ text: dayText(view), keyboard: dayKeyboard(view) });

const PICK_ACTION: Partial<Record<OwnerBotCallbackAction, OwnerBotPickAction>> = {
  collect: 'collected',
  reserve: 'reserve',
  left: 'left',
  allcollect: 'all_collected',
  allreserve: 'all_reserve',
};

/** The choice a pending row asks to confirm, or null when the row is not one. */
export function ownerBotConfirmChoice(pending: OwnerBotPendingButton): OwnerBotConfirmChoice | null {
  const { action, amount } = pending;
  if (pending.kind === 'all_choice') {
    return (action === 'collected' || action === 'reserve') && pending.items.length > 0
      ? { kind: 'all', action, items: pending.items }
      : null;
  }
  if (pending.kind === 'bar_choice') {
    return (action === 'reserve' || action === 'left') && amount !== null
      ? { kind: 'bar', action, amount, capped: pending.capped }
      : null;
  }
  if (pending.kind === 'choice') {
    return pending.method && (action === 'collected' || action === 'reserve') && amount !== null
      ? { kind: 'method', method: pending.method, action, amount }
      : null;
  }
  return null;
}

/** The day with the question "save this?" under it, or null when the row is not a choice. */
export function ownerBotConfirmEdit(view: OwnerBotDayView, pending: OwnerBotPendingButton): OwnerBotMessageEdit | null {
  const choice = ownerBotConfirmChoice(pending);
  return choice ? { text: confirmText(view, choice), keyboard: confirmKeyboard(pending.id) } : null;
}

/** The day's figures and its database state, as one message's contents. */
export async function ownerBotViewOf(supabase: SupabaseClient, state: OwnerBotDayState, now: Date): Promise<OwnerBotDayView> {
  return buildOwnerBotDayView(
    await fetchOwnerBotDayOn(supabase, { id: state.clubId, name: state.clubName }, state.businessDate),
    state,
    now,
  );
}

export async function handleOwnerBotCallback(
  supabase: SupabaseClient,
  press: OwnerBotCallbackQuery,
  { now = new Date() }: { now?: Date } = {},
): Promise<OwnerBotCallbackReply> {
  // A button outside the presser's own chat with the bot is never acted on.
  if (!press.privateChat) return refused('forbidden');
  const button = parseOwnerBotCallbackData(press.data);
  if (!button) return refused('expired');
  const telegramUserId = press.telegramUserId;

  const viewOf = (state: OwnerBotDayState) => ownerBotViewOf(supabase, state, now);
  // The money is already saved or undone: the toast says so even when the
  // day cannot be read again, and the message then stays as it is.
  const afterSave = async (state: OwnerBotDayWithResult): Promise<OwnerBotCallbackReply> => {
    const answer = { text: resultToastText(state.result), showAlert: false };
    try {
      return { answer, edit: dayEdit(await viewOf(state)) };
    } catch (error) {
      console.error('[telegram/owner-bot] message not redrawn after a press:', button.action, describe(error));
      return { answer, edit: null };
    }
  };
  // Read only and never refused for age (193), so an old button still brings the day back.
  const dayAfterRefusal = async (id: string): Promise<OwnerBotMessageEdit | null> => {
    try {
      return dayEdit(await viewOf(await readOwnerBotButton(supabase, telegramUserId, id)));
    } catch {
      return null;
    }
  };

  try {
    switch (button.action) {
      case 'menu':
      case 'amount': {
        const state = await readOwnerBotButton(supabase, telegramUserId, button.id);
        const view = await viewOf(state);
        const { pending } = state;
        if (pending.expired) return refused('expired', dayEdit(view));
        if (pending.kind === 'day' && button.action === 'menu') {
          if (view.bar.status !== 'open') return refused(view.bar.status === 'empty' ? 'nothing_in_bar' : 'already_marked', dayEdit(view));
          return { answer: silent, edit: { text: barMenuText(view), keyboard: barMenuKeyboard(button.id) } };
        }
        if (pending.kind !== 'line' || !pending.method) return refused('expired', dayEdit(view));
        const line = ownerBotLine(view, pending.method);
        if (!line || line.status !== 'open') {
          return refused(line?.status === 'empty' || !line ? 'nothing_in_till' : 'already_marked', dayEdit(view));
        }
        return button.action === 'menu'
          ? { answer: silent, edit: { text: methodMenuText(view, line), keyboard: methodMenuKeyboard(button.id) } }
          : { answer: silent, edit: { text: amountMenuText(view, line), keyboard: amountMenuKeyboard(button.id) } };
      }
      case 'back':
      case 'no':
        return { answer: silent, edit: dayEdit(await viewOf(await readOwnerBotButton(supabase, telegramUserId, button.id))) };
      case 'collect':
      case 'reserve':
      case 'left':
      case 'allcollect':
      case 'allreserve': {
        const state = await pickOwnerBotAction(supabase, telegramUserId, button.id, PICK_ACTION[button.action]!);
        const edit = ownerBotConfirmEdit(await viewOf(state), state.pending);
        if (!edit) throw new Error('owner_bot_pick answered without a choice');
        return { answer: silent, edit };
      }
      case 'askcollect':
      case 'askreserve': {
        const state = await askOwnerBotAmount(supabase, {
          telegramUserId,
          id: button.id,
          action: button.action === 'askcollect' ? 'collected' : 'reserve',
          chatId: press.chatId,
          messageId: press.messageId,
        });
        const view = await viewOf(state);
        return {
          answer: { text: amountPromptToastText(), showAlert: false },
          // The day again: the question below is answered in a reply, and the confirmation comes back here.
          edit: dayEdit(view),
          prompt: { promptId: state.prompt.id, text: amountPromptText({ clubName: view.clubName, ...state.prompt }) },
        };
      }
      case 'yes':
        return afterSave(await confirmOwnerBotAction(supabase, {
          telegramUserId,
          choiceId: button.id,
          chatId: press.chatId,
          messageId: press.messageId,
        }));
      case 'undo':
        return afterSave(await undoOwnerBotAction(supabase, telegramUserId, button.id));
    }
  } catch (error) {
    const refusal = error instanceof OwnerBotActionError ? error.refusal : null;
    if (!refusal) {
      console.error('[telegram/owner-bot] button press failed:', button.action, describe(error));
      return { answer: { text: pressFailedText(), showAlert: true }, edit: null };
    }
    // Back to the day, so the owner is not left on a question that no longer holds.
    const redraw = refusal !== 'forbidden' && button.action !== 'undo';
    return refused(refusal, redraw ? await dayAfterRefusal(button.id) : null);
  }
}

function describe(error: unknown): string {
  if (error instanceof OwnerBotActionError) return `${error.code ?? '-'} ${error.hint ?? '-'} ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
