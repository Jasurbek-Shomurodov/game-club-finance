import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchOwnerBotClubs, isOwnerBotTelegramLinked, redeemOwnerBotLinkCode } from './accounts';
import { OwnerBotActionError, answerOwnerBotAmount, openOwnerBotDay } from './actions';
import { parseOwnerBotAmount } from './amount';
import { ownerBotConfirmEdit, ownerBotViewOf } from './callbacks';
import { parseOwnerBotCommand } from './commands';
import { fetchOwnerBotDay } from './day';
import { buildOwnerBotDayView } from './dayView';
import { dayKeyboard, type OwnerBotKeyboard } from './keyboard';
import {
  amountPromptExpiredText,
  amountPromptText,
  clubsText,
  dayText,
  dayUnavailableText,
  helpText,
  linkResultText,
  linkUsageText,
  noClubsText,
  notLinkedText,
  refusalText,
  startText,
} from './texts';
import type { OwnerBotMessage } from './update';

/** One message the bot sends back, with the buttons it carries. */
export interface OwnerBotReply {
  text: string;
  keyboard: OwnerBotKeyboard | null;
  /** Sent as the ForceReply question of this prompt row, whose message id is then recorded (✏️ Другая сумма). */
  promptId?: string;
  /**
   * An earlier day message this one takes over from: before sending, it is
   * redrawn with this text and no buttons, so only one message of the day
   * keeps live buttons (best effort).
   */
  retire?: { chatId: number; messageId: number; text: string };
}

const plain = (text: string): OwnerBotReply => ({ text, keyboard: null });

/**
 * Answers one private message to the owner bot with the messages to send
 * back, in order (one per club for /today). Nothing here moves money: the
 * /today buttons do, through callbacks.ts, and a typed amount only becomes a
 * choice to confirm. Throws when the database cannot be read; the route then
 * sends a short error text.
 */
export async function handleOwnerBotMessage(
  supabase: SupabaseClient,
  message: OwnerBotMessage,
  { now = new Date() }: { now?: Date } = {},
): Promise<OwnerBotReply[]> {
  return (await answerOwnerBotMessage(supabase, message, now)).map((reply) => (typeof reply === 'string' ? plain(reply) : reply));
}

async function answerOwnerBotMessage(supabase: SupabaseClient, message: OwnerBotMessage, now: Date): Promise<Array<string | OwnerBotReply>> {
  const command = parseOwnerBotCommand(message.text);
  const redeem = async (code: string) => linkResultText(await redeemOwnerBotLinkCode(supabase, {
    code,
    telegramUserId: message.telegramUserId,
    username: message.username,
  }));

  switch (command.kind) {
    case 'link':
      return [command.code ? await redeem(command.code) : linkUsageText()];
    case 'start':
      // t.me/<bot>?start=<code> opens the chat with /start <code>.
      if (command.code) return [await redeem(command.code)];
      return [startText(await isOwnerBotTelegramLinked(supabase, message.telegramUserId))];
    case 'clubs': {
      if (!await isOwnerBotTelegramLinked(supabase, message.telegramUserId)) return [notLinkedText()];
      return [clubsText(await fetchOwnerBotClubs(supabase, message.telegramUserId))];
    }
    case 'today': {
      if (!await isOwnerBotTelegramLinked(supabase, message.telegramUserId)) return [notLinkedText()];
      const clubs = await fetchOwnerBotClubs(supabase, message.telegramUserId);
      if (clubs.length === 0) return [noClubsText()];
      // Each club is read on its own, scoped to its id; one failing club does not hide the others.
      return Promise.all(clubs.map(async (club): Promise<OwnerBotReply> => {
        try {
          const day = await fetchOwnerBotDay(supabase, club, now);
          // The till, the marks and the buttons, read as the linked owner (193).
          const state = await openOwnerBotDay(supabase, {
            telegramUserId: message.telegramUserId,
            clubId: club.id,
            businessDate: day.businessDate,
          });
          const view = buildOwnerBotDayView(day, state, now);
          return { text: dayText(view), keyboard: dayKeyboard(view) };
        } catch (error) {
          console.error('[telegram/owner-bot] day unavailable for a club:', club.id, error instanceof Error ? error.message : error);
          return plain(dayUnavailableText(club.name));
        }
      }));
    }
    case 'help':
    case 'unknown':
      // A reply to the bot's own question is the typed amount of ✏️ Другая сумма.
      if (command.kind === 'unknown' && message.replyToMessageId !== null) {
        return answerAmount(supabase, message, message.replyToMessageId, now);
      }
      return [helpText(await isOwnerBotTelegramLinked(supabase, message.telegramUserId))];
  }
}

/**
 * The owner's answer to "how much?": matched by the question's message and
 * the sender's Telegram account. A good sum becomes the usual confirmation,
 * sent below the answer where the owner is looking; the day message it was
 * asked from keeps its text and loses its buttons. Anything else asks again.
 */
async function answerAmount(
  supabase: SupabaseClient,
  message: OwnerBotMessage,
  promptMessageId: number,
  now: Date,
): Promise<Array<string | OwnerBotReply>> {
  const amount = parseOwnerBotAmount(message.text);
  let answer;
  try {
    answer = await answerOwnerBotAmount(supabase, { telegramUserId: message.telegramUserId, promptMessageId, amount });
  } catch (error) {
    const refusal = error instanceof OwnerBotActionError ? error.refusal : null;
    if (refusal === 'expired') {
      // A reply to some other message of the bot that is not a sum is just a message.
      return [amount === null ? helpText(await isOwnerBotTelegramLinked(supabase, message.telegramUserId)) : amountPromptExpiredText()];
    }
    if (refusal) return [refusalText(refusal)];
    throw error;
  }

  if (answer.status !== 'chosen') {
    return [{
      text: amountPromptText({ clubName: answer.clubName, ...answer.prompt }, answer.status),
      keyboard: null,
      promptId: answer.prompt.id,
    }];
  }
  const view = await ownerBotViewOf(supabase, answer, now);
  const confirmation = ownerBotConfirmEdit(view, answer.pending);
  if (!confirmation) throw new Error('owner_bot_answer_amount answered without a choice');
  const { dayChatId, dayMessageId } = answer.prompt;
  return [{
    ...confirmation,
    ...(dayChatId === message.chatId && dayMessageId !== null
      ? { retire: { chatId: dayChatId, messageId: dayMessageId, text: dayText(view) } }
      : {}),
  }];
}
