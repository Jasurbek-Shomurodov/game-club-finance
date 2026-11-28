import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchOwnerBotClubs, isOwnerBotTelegramLinked, redeemOwnerBotLinkCode } from './accounts';
import { parseOwnerBotCommand } from './commands';
import { fetchOwnerBotDay } from './day';
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

/**
 * Answers one private message to the owner bot with the texts to send back,
 * in order (one per club for /today). Read-only apart from /link: nothing
 * here moves money yet (buttons come in slice 3). Throws when the database
 * cannot be read; the route then sends a short error text.
 */
export async function handleOwnerBotMessage(
  supabase: SupabaseClient,
  message: OwnerBotMessage,
  { now = new Date() }: { now?: Date } = {},
): Promise<string[]> {
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
      return Promise.all(clubs.map(async (club) => {
        try {
          return dayText(await fetchOwnerBotDay(supabase, club, now));
        } catch (error) {
          console.error('[telegram/owner-bot] day unavailable for a club:', club.id, error instanceof Error ? error.message : error);
          return dayUnavailableText(club.name);
        }
      }));
    }
    case 'help':
    case 'unknown':
      return [helpText(await isOwnerBotTelegramLinked(supabase, message.telegramUserId))];
  }
}
