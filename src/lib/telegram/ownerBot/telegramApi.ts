import { truncateTelegramText } from '../sendDailyFinanceReport';
import type { OwnerBotKeyboard } from './keyboard';

/**
 * The two Bot API calls a button press needs: answerCallbackQuery (the toast
 * or alert, which also stops the button's spinner) and editMessageText (the
 * message redrawn in place). Errors never carry the bot token.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org';
/** Telegram's limit for a callback answer's text. */
export const CALLBACK_ANSWER_MAX_LENGTH = 200;
const DEFAULT_TIMEOUT_MS = 5_000;

interface TelegramAnswer {
  ok?: boolean;
  description?: string;
}

interface CallOptions {
  botToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

async function callTelegram(
  method: 'answerCallbackQuery' | 'editMessageText',
  body: Record<string, unknown>,
  { botToken, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }: CallOptions,
): Promise<TelegramAnswer | null> {
  let response: Response;
  try {
    response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Telegram ${method} failed: ${reason.replaceAll(botToken, '[REDACTED]').slice(0, 300)}`);
  }
  const payload = await response.json().catch(() => null) as TelegramAnswer | null;
  if (response.ok && payload?.ok === true) return payload;
  const description = (payload?.description ?? `HTTP ${response.status}`).replaceAll(botToken, '[REDACTED]').slice(0, 300);
  throw new Error(`Telegram ${method} failed: ${description}`);
}

/** Answers a button press: a short toast, or an alert the owner closes. An empty text only stops the spinner. */
export async function answerOwnerBotCallback(
  { callbackQueryId, text, showAlert = false, ...options }: CallOptions & { callbackQueryId: string; text: string; showAlert?: boolean },
): Promise<void> {
  await callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text: text.slice(0, CALLBACK_ANSWER_MAX_LENGTH) } : {}),
    ...(showAlert ? { show_alert: true } : {}),
  }, options);
}

/**
 * Redraws a message the bot sent. Without a keyboard the message keeps none.
 * The same text and keyboard again (a repeated press) is not an error.
 */
export async function editOwnerBotMessage(
  { chatId, messageId, text, keyboard, ...options }: CallOptions & {
    chatId: number;
    messageId: number;
    text: string;
    keyboard: OwnerBotKeyboard | null;
  },
): Promise<void> {
  try {
    await callTelegram('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: truncateTelegramText(text),
      ...(keyboard ? { reply_markup: keyboard } : {}),
    }, options);
  } catch (error) {
    if (error instanceof Error && /message is not modified/i.test(error.message)) return;
    throw error;
  }
}
