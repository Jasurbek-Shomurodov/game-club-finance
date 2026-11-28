/**
 * The parts of a Telegram update the owner bot acts on. Only text messages in
 * a private chat with a person count: group and channel messages, bots,
 * edited messages and button presses (no buttons yet) are ignored, so an
 * admin in a club group can never reach the bot through a group.
 */
export interface OwnerBotMessage {
  updateId: number;
  chatId: number;
  telegramUserId: number;
  username: string | null;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The private text message in an update, or null when the bot should ignore the update. */
export function parseOwnerBotMessage(update: unknown): OwnerBotMessage | null {
  if (!isRecord(update) || !isRecord(update.message)) return null;
  const { message } = update;
  const chat = isRecord(message.chat) ? message.chat : null;
  const from = isRecord(message.from) ? message.from : null;
  if (!chat || !from || chat.type !== 'private' || from.is_bot === true) return null;

  const chatId = positiveId(chat.id);
  const telegramUserId = positiveId(from.id);
  // In a private chat the chat is the person; anything else is not a direct message.
  if (chatId === null || telegramUserId === null || chatId !== telegramUserId) return null;
  if (typeof message.text !== 'string' || message.text.trim() === '') return null;

  const updateId = typeof update.update_id === 'number' ? update.update_id : 0;
  const username = typeof from.username === 'string' && from.username.trim() ? from.username.trim() : null;
  return { updateId, chatId, telegramUserId, username, text: message.text };
}
