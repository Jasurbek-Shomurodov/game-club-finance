import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTelegramMessage, TelegramSendError } from '../sendDailyFinanceReport';
import { openOwnerBotDay } from './actions';
import { fetchOwnerBotDayOn } from './day';
import { buildOwnerBotDayView } from './dayView';
import { dayKeyboard } from './keyboard';
import { dayText, type OwnerBotDay } from './texts';

/**
 * The morning message (docs/plans/owner-money-bot.md, slice 5): right after
 * the daily report of a club is delivered, every owner of that club who
 * linked Telegram gets the same message /today sends, with its buttons, from
 * the owner bot. It never affects the report: nothing here throws, and it
 * runs only after the report's delivery is recorded.
 *
 * Once per club, business date and owner: owner_bot_claim_day_message (193)
 * is taken before sending and never again, so the report's retry runs and a
 * lost Telegram answer do not send twice. A send that definitely failed gives
 * the claim back for a later run; an unknown outcome (a timeout after the
 * request went out) keeps it, and the owner can send /today.
 */

export interface OwnerBotMorningResult {
  /** The owner bot is not configured (no TELEGRAM_OWNER_BOT_TOKEN): nothing was tried. */
  skipped: boolean;
  sent: number;
  /** Owners who already had this day's message. */
  alreadySent: number;
  failed: number;
}

const SEND_ATTEMPTS = 2;
const SEND_TIMEOUT_MS = 5_000;

function log(event: string, fields: Record<string, unknown>) {
  console.error(JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields }));
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function ownerTelegramIds(supabase: SupabaseClient, clubId: string): Promise<number[]> {
  const { data, error } = await supabase.rpc('owner_bot_club_owner_telegram_ids', { p_club_id: clubId });
  if (error) throw error;
  return ((data ?? []) as Array<{ telegram_user_id: unknown } | number>)
    .map((row) => Number(typeof row === 'object' && row !== null ? row.telegram_user_id : row))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

async function rpcOrThrow(supabase: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function sendOwnerBotMorningMessages(
  supabase: SupabaseClient,
  { clubId, businessDate, now = new Date(), deadlineAt }: { clubId: string; businessDate: string; now?: Date; deadlineAt: number },
): Promise<OwnerBotMorningResult> {
  const result: OwnerBotMorningResult = { skipped: false, sent: 0, alreadySent: 0, failed: 0 };
  const botToken = process.env.TELEGRAM_OWNER_BOT_TOKEN;
  if (!botToken) return { ...result, skipped: true };

  let owners: number[];
  try {
    owners = await ownerTelegramIds(supabase, clubId);
  } catch (error) {
    log('owner_bot_morning_owners_failed', { clubId, businessDate, error: describe(error) });
    return { ...result, failed: 1 };
  }

  // The day's figures are the same for every owner of the club; read once, when someone needs them.
  let day: Promise<OwnerBotDay> | null = null;
  const dayOf = () => (day ??= fetchOwnerBotDayOn(supabase, { id: clubId, name: '' }, businessDate));

  for (const telegramUserId of owners) {
    if (Date.now() >= deadlineAt) {
      log('owner_bot_morning_out_of_time', { clubId, businessDate, left: owners.length - result.sent - result.alreadySent - result.failed });
      break;
    }
    const key = { p_club_id: clubId, p_date: businessDate, p_telegram_user_id: telegramUserId };
    let claimed: boolean;
    try {
      claimed = await rpcOrThrow(supabase, 'owner_bot_claim_day_message', key) === true;
    } catch (error) {
      result.failed += 1;
      log('owner_bot_morning_claim_failed', { clubId, businessDate, error: describe(error) });
      continue;
    }
    if (!claimed) {
      result.alreadySent += 1;
      continue;
    }

    let outcomeUnknown = false;
    try {
      // Read as this owner (193): their own buttons and undo, refused if they no longer own the club.
      const state = await openOwnerBotDay(supabase, { telegramUserId, clubId, businessDate });
      const view = buildOwnerBotDayView(await dayOf(), state, now);
      const keyboard = dayKeyboard(view);
      let sent;
      try {
        sent = await sendTelegramMessage({
          botToken,
          chatId: String(telegramUserId),
          text: dayText(view),
          replyMarkup: keyboard ? { ...keyboard } : null,
          maxAttempts: SEND_ATTEMPTS,
          timeoutMs: SEND_TIMEOUT_MS,
          deadlineAt,
        });
      } catch (error) {
        outcomeUnknown = !(error instanceof TelegramSendError) || error.requiresManualReview;
        throw error;
      }
      result.sent += 1;
      try {
        await rpcOrThrow(supabase, 'owner_bot_finish_day_message', {
          ...key,
          p_chat_id: sent.result.chat.id,
          p_message_id: sent.result.message_id,
        });
      } catch (error) {
        // Sent; the claim stays, so it is still never sent again.
        log('owner_bot_morning_record_failed', { clubId, businessDate, error: describe(error) });
      }
    } catch (error) {
      result.failed += 1;
      // TelegramSendError messages never contain the token.
      log('owner_bot_morning_send_failed', { clubId, businessDate, outcomeUnknown, error: describe(error) });
      if (!outcomeUnknown) {
        try {
          await rpcOrThrow(supabase, 'owner_bot_release_day_message', key);
        } catch (releaseError) {
          log('owner_bot_morning_release_failed', { clubId, businessDate, error: describe(releaseError) });
        }
      }
    }
  }
  return result;
}
