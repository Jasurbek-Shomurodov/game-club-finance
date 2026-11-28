/**
 * The parts of a Telegram update the owner bot acts on. Only text messages in
 * a private chat with a person count: group and channel messages, bots and
 * edited messages are ignored, so an admin in a club group can never reach
 * the bot through a group. Button presses are read by
 * parseOwnerBotCallbackQuery below.
 */
export interface OwnerBotMessage {
  updateId: number;
  chatId: number;
  telegramUserId: number;
  username: string | null;
  text: string;
  /**
   * The bot's message this one replies to (the ForceReply question of
   * ✏️ Другая сумма), or null. Only a reply to a bot's message counts.
   */
  replyToMessageId: number | null;
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
  const repliedTo = isRecord(message.reply_to_message) ? message.reply_to_message : null;
  const repliedFrom = repliedTo && isRecord(repliedTo.from) ? repliedTo.from : null;
  const replyToMessageId = repliedTo && repliedFrom?.is_bot === true ? positiveId(repliedTo.message_id) : null;
  return { updateId, chatId, telegramUserId, username, text: message.text, replyToMessageId };
}

/**
 * A press of one of the bot's inline buttons. `privateChat` is false when the
 * button's message is not the presser's own private chat with the bot (a
 * group, someone else's chat, or a message Telegram no longer shows); such a
 * press is answered but never acted on.
 */
export interface OwnerBotCallbackQuery {
  updateId: number;
  callbackQueryId: string;
  telegramUserId: number;
  chatId: number | null;
  messageId: number | null;
  privateChat: boolean;
  data: string | null;
}

/** The button press in an update, or null when the update is not one a person made. */
export function parseOwnerBotCallbackQuery(update: unknown): OwnerBotCallbackQuery | null {
  if (!isRecord(update) || !isRecord(update.callback_query)) return null;
  const query = update.callback_query;
  const from = isRecord(query.from) ? query.from : null;
  if (typeof query.id !== 'string' || query.id === '' || !from || from.is_bot === true) return null;
  const telegramUserId = positiveId(from.id);
  if (telegramUserId === null) return null;

  const message = isRecord(query.message) ? query.message : null;
  const chat = message && isRecord(message.chat) ? message.chat : null;
  const chatId = chat ? positiveId(chat.id) : null;
  const messageId = message ? positiveId(message.message_id) : null;
  const privateChat = chat?.type === 'private' && chatId === telegramUserId && messageId !== null;

  return {
    updateId: typeof update.update_id === 'number' ? update.update_id : 0,
    callbackQueryId: query.id,
    telegramUserId,
    chatId,
    messageId,
    privateChat,
    data: typeof query.data === 'string' ? query.data : null,
  };
}
