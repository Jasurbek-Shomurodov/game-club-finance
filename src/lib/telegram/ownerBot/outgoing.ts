import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTelegramMessage } from '../sendDailyFinanceReport';
import { recordOwnerBotPrompt } from './actions';
import type { OwnerBotReply } from './handler';
import { AMOUNT_PROMPT_MARKUP } from './keyboard';
import { editOwnerBotMessage } from './telegramApi';

/**
 * Sends what the owner bot answers: a plain message with its buttons, or the
 * ForceReply question of ✏️ Другая сумма, whose message id is recorded so the
 * owner's reply can be matched to it (owner_bot_prompt_sent, 193). Errors
 * never carry the bot token (TelegramSendError, telegramApi.ts).
 */

interface SendOptions {
  botToken: string;
  chatId: number;
  telegramUserId: number;
  deadlineAt: number;
}

const SEND_ATTEMPTS = 2;
const SEND_TIMEOUT_MS = 5_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The question of one prompt row, sent with ForceReply, then remembered by its message id. */
export async function sendOwnerBotPrompt(
  supabase: SupabaseClient,
  { promptId, text, ...options }: SendOptions & { promptId: string; text: string },
): Promise<void> {
  const sent = await sendTelegramMessage({
    botToken: options.botToken,
    chatId: String(options.chatId),
    text,
    replyMarkup: { ...AMOUNT_PROMPT_MARKUP },
    maxAttempts: SEND_ATTEMPTS,
    timeoutMs: SEND_TIMEOUT_MS,
    deadlineAt: options.deadlineAt,
  });
  await recordOwnerBotPrompt(supabase, {
    telegramUserId: options.telegramUserId,
    promptId,
    promptMessageId: sent.result.message_id,
  });
}

/** One reply of handleOwnerBotMessage. Throws when it could not be sent. */
export async function deliverOwnerBotReply(supabase: SupabaseClient, reply: OwnerBotReply, options: SendOptions): Promise<void> {
  if (reply.retire) {
    try {
      await editOwnerBotMessage({ botToken: options.botToken, ...reply.retire, keyboard: null });
    } catch (error) {
      // The new message still goes out; the old one only keeps its buttons, which stay safe to press.
      console.error('[telegram/owner-bot] earlier message not redrawn:', describe(error));
    }
  }
  if (reply.promptId) {
    await sendOwnerBotPrompt(supabase, { ...options, promptId: reply.promptId, text: reply.text });
    return;
  }
  await sendTelegramMessage({
    botToken: options.botToken,
    chatId: String(options.chatId),
    text: reply.text,
    replyMarkup: reply.keyboard ? { ...reply.keyboard } : null,
    maxAttempts: SEND_ATTEMPTS,
    timeoutMs: SEND_TIMEOUT_MS,
    deadlineAt: options.deadlineAt,
  });
}
