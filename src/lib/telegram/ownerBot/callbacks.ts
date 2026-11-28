import type { SupabaseClient } from '@supabase/supabase-js';
import {
  OwnerBotActionError,
  chooseOwnerBotAction,
  confirmOwnerBotAction,
  readOwnerBotPending,
  undoOwnerBotAction,
  type OwnerBotDayState,
  type OwnerBotDayWithResult,
  type OwnerBotRefusal,
} from './actions';
import { parseOwnerBotCallbackData } from './callbackData';
import { fetchOwnerBotDayOn } from './day';
import { buildOwnerBotDayView, ownerBotLine, type OwnerBotDayView } from './dayView';
import { confirmKeyboard, dayKeyboard, methodMenuKeyboard, type OwnerBotKeyboard } from './keyboard';
import {
  confirmText,
  dayText,
  methodMenuText,
  pressFailedText,
  refusalText,
  resultToastText,
} from './texts';
import type { OwnerBotCallbackQuery } from './update';

/**
 * Answers one press of an owner bot button: the toast or alert, and how the
 * message is redrawn. Every press goes through a migration 192 wrapper,
 * which checks again that the presser's linked user owns the club; nothing
 * the button carries but a row id is trusted.
 */

export interface OwnerBotMessageEdit {
  text: string;
  keyboard: OwnerBotKeyboard | null;
}

export interface OwnerBotCallbackReply {
  answer: { text: string; showAlert: boolean };
  /** Null: leave the message as it is. */
  edit: OwnerBotMessageEdit | null;
}

const silent = { text: '', showAlert: false };

const refused = (refusal: OwnerBotRefusal, edit: OwnerBotMessageEdit | null = null): OwnerBotCallbackReply => ({
  answer: { text: refusalText(refusal), showAlert: true },
  edit,
});

const dayEdit = (view: OwnerBotDayView): OwnerBotMessageEdit => ({ text: dayText(view), keyboard: dayKeyboard(view) });

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

  const viewOf = async (state: OwnerBotDayState) => buildOwnerBotDayView(
    await fetchOwnerBotDayOn(supabase, { id: state.clubId, name: state.clubName }, state.businessDate),
    state,
    now,
  );
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
  const dayAfterRefusal = async (id: string): Promise<OwnerBotMessageEdit | null> => {
    try {
      return dayEdit(await viewOf(await readOwnerBotPending(supabase, telegramUserId, id)));
    } catch {
      return null;
    }
  };

  try {
    switch (button.action) {
      case 'menu': {
        const state = await readOwnerBotPending(supabase, telegramUserId, button.id);
        if (state.pending.action !== null) return refused('expired');
        const view = await viewOf(state);
        const line = ownerBotLine(view, state.pending.method);
        if (!line || line.status !== 'open') {
          return refused(line?.status === 'empty' || !line ? 'nothing_in_till' : 'already_marked', dayEdit(view));
        }
        return { answer: silent, edit: { text: methodMenuText(view, line), keyboard: methodMenuKeyboard(button.id) } };
      }
      case 'back':
      case 'no':
        return { answer: silent, edit: dayEdit(await viewOf(await readOwnerBotPending(supabase, telegramUserId, button.id))) };
      case 'collect':
      case 'reserve': {
        const state = await chooseOwnerBotAction(supabase, telegramUserId, button.id, button.action === 'collect' ? 'collected' : 'reserve');
        const { pending } = state;
        if (pending.action === null || pending.amount === null) throw new Error('owner_bot_choose answered without a choice');
        const view = await viewOf(state);
        return {
          answer: silent,
          edit: {
            text: confirmText(view, { method: pending.method, action: pending.action, amount: pending.amount }),
            keyboard: confirmKeyboard(pending.id),
          },
        };
      }
      case 'yes': {
        const state = await confirmOwnerBotAction(supabase, {
          telegramUserId,
          choiceId: button.id,
          chatId: press.chatId,
          messageId: press.messageId,
        });
        return afterSave(state);
      }
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
    const redraw = refusal !== 'forbidden' && refusal !== 'expired' && button.action !== 'undo';
    return refused(refusal, redraw ? await dayAfterRefusal(button.id) : null);
  }
}

function describe(error: unknown): string {
  if (error instanceof OwnerBotActionError) return `${error.code ?? '-'} ${error.hint ?? '-'} ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
