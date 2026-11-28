import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchOwnerBotClubs, isOwnerBotTelegramLinked, redeemOwnerBotLinkCode } from './accounts';
import { openOwnerBotDay } from './actions';
import { parseOwnerBotCommand } from './commands';
import { fetchOwnerBotDay } from './day';
import { buildOwnerBotDayView } from './dayView';
import { dayKeyboard, type OwnerBotKeyboard } from './keyboard';
import {
  clubsText,
  dayText,
  dayUnavailableText,
  helpText,
  linkResultText,
  linkUsageText,
  noClubsText,
  notLinkedText,
  startText,
} from './texts';
import type { OwnerBotMessage } from './update';

/** One message the bot sends back, with the buttons it carries (only /today has any). */
export interface OwnerBotReply {
  text: string;
  keyboard: OwnerBotKeyboard | null;
}

const plain = (text: string): OwnerBotReply => ({ text, keyboard: null });

/**
 * Answers one private message to the owner bot with the messages to send
 * back, in order (one per club for /today). Nothing here moves money: the
 * /today buttons do, through callbacks.ts. Throws when the database cannot be
 * read; the route then sends a short error text.
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
          // The till, the marks and the line buttons, read as the linked owner (192).
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
      return [helpText(await isOwnerBotTelegramLinked(supabase, message.telegramUserId))];
  }
}
