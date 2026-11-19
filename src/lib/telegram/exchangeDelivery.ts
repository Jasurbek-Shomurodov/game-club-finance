import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { ExchangeMethod } from '@/lib/calculations/moneyExchanges';
import { actorName } from './actorName';
import { targetChatId } from './clubChat';
import { buildExchangeNotification } from './exchangeNotification';
import { sendTelegramMessage } from './sendDailyFinanceReport';

/** A money_exchanges row as the exchange routes read it back after saving. */
export interface ExchangeRow {
  id: string;
  club_id: string;
  date: string;
  from_method: ExchangeMethod;
  to_method: ExchangeMethod;
  from_amount: number | string;
  to_amount: number | string;
  rate: number | string | null;
  comment: string;
  telegram_chat_id: string | null;
  telegram_message_id: number | string | null;
}

/**
 * Best-effort, after the response: Telegram never fails or delays a saved
 * exchange. The message coordinates are stored so deleting the exchange
 * removes the message. `inReserve`: bought or sold with the reserve's own sums (170).
 */
export async function notifyExchange(supabase: SupabaseClient, user: User, exchange: ExchangeRow, inReserve = false) {
  const chatId = targetChatId(exchange.club_id);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !botToken) return;
  try {
    const telegram = await sendTelegramMessage({
      botToken,
      chatId,
      text: buildExchangeNotification({
        addedBy: await actorName(supabase, user),
        date: exchange.date,
        from: exchange.from_method,
        to: exchange.to_method,
        fromAmount: Number(exchange.from_amount),
        toAmount: Number(exchange.to_amount),
        rate: exchange.rate === null ? null : Number(exchange.rate),
        comment: exchange.comment || null,
        inReserve,
      }),
    });
    const { error } = await supabase.rpc('set_money_exchange_telegram_message', {
      p_club_id: exchange.club_id,
      p_id: exchange.id,
      p_chat_id: String(telegram.result.chat.id),
      p_message_id: telegram.result.message_id,
    });
    if (error) {
      console.error('[telegram/exchange] message coordinates were not saved', {
        clubId: exchange.club_id, exchangeId: exchange.id, error: error.message,
      });
    }
  } catch (notificationError) {
    console.error('[telegram/exchange] notification failed', {
      clubId: exchange.club_id,
      exchangeId: exchange.id,
      error: notificationError instanceof Error ? notificationError.message : String(notificationError),
    });
  }
}
