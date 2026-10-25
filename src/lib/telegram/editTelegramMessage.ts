import { truncateTelegramText } from './sendDailyFinanceReport';

interface EditTelegramMessageOptions {
  botToken: string;
  chatId: string;
  messageId: number;
  text: string;
  fetchImpl?: typeof fetch;
}
interface TelegramEditResponse {
  ok?: boolean;
  description?: string;
}

/** Replaces the text of a message the bot sent earlier. */
export async function editTelegramMessage({
  botToken,
  chatId,
  messageId,
  text,
  fetchImpl = fetch,
}: EditTelegramMessageOptions): Promise<void> {
  const response = await fetchImpl(
    `https://api.telegram.org/bot${botToken}/editMessageText`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: truncateTelegramText(text) }),
    },
  );
  const payload = await response.json().catch(() => null) as TelegramEditResponse | null;

  if (response.ok && payload?.ok === true) return;

  // Same text as before (e.g. a repeated save): the message already shows it.
  if (payload?.description?.toLowerCase().includes('message is not modified')) return;

  throw new Error(payload?.description || `Telegram editMessageText failed with HTTP ${response.status}`);
}
