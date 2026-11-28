import { describe, expect, it } from 'vitest';
import { parseOwnerBotCallbackQuery, parseOwnerBotMessage } from './update';

const privateMessage = (overrides: Record<string, unknown> = {}) => ({
  update_id: 10,
  message: {
    message_id: 5,
    chat: { id: 4242, type: 'private' },
    from: { id: 4242, is_bot: false, username: 'pixel_owner' },
    text: '/today',
    ...overrides,
  },
});

describe('parseOwnerBotMessage', () => {
  it('reads a private text message from a person', () => {
    expect(parseOwnerBotMessage(privateMessage())).toEqual({
      updateId: 10, chatId: 4242, telegramUserId: 4242, username: 'pixel_owner', text: '/today',
    });
    expect(parseOwnerBotMessage(privateMessage({ from: { id: 4242 } }))?.username).toBeNull();
  });

  it('ignores groups, channels and bots', () => {
    expect(parseOwnerBotMessage(privateMessage({ chat: { id: -100123, type: 'supergroup' } }))).toBeNull();
    expect(parseOwnerBotMessage(privateMessage({ chat: { id: -100123, type: 'group' } }))).toBeNull();
    expect(parseOwnerBotMessage(privateMessage({ chat: { id: -100123, type: 'channel' } }))).toBeNull();
    expect(parseOwnerBotMessage(privateMessage({ from: { id: 4242, is_bot: true } }))).toBeNull();
    // A private chat is always with the sender.
    expect(parseOwnerBotMessage(privateMessage({ chat: { id: 9999, type: 'private' } }))).toBeNull();
  });

  it('ignores updates without a usable text message', () => {
    expect(parseOwnerBotMessage(null)).toBeNull();
    expect(parseOwnerBotMessage([])).toBeNull();
    expect(parseOwnerBotMessage({ update_id: 1, callback_query: { id: 'x' } })).toBeNull();
    expect(parseOwnerBotMessage({ update_id: 1, edited_message: privateMessage().message })).toBeNull();
    expect(parseOwnerBotMessage(privateMessage({ text: undefined, photo: [] }))).toBeNull();
    expect(parseOwnerBotMessage(privateMessage({ text: '   ' }))).toBeNull();
    expect(parseOwnerBotMessage(privateMessage({ from: { id: '4242' } }))).toBeNull();
    expect(parseOwnerBotMessage(privateMessage({ chat: { id: 4242.5, type: 'private' }, from: { id: 4242.5 } }))).toBeNull();
  });
});

const press = (overrides: Record<string, unknown> = {}, message: Record<string, unknown> | null = {}) => ({
  update_id: 11,
  callback_query: {
    id: 'q1',
    from: { id: 4242, is_bot: false },
    data: 'v1:menu:x',
    ...(message === null ? {} : { message: { message_id: 7, chat: { id: 4242, type: 'private' }, ...message } }),
    ...overrides,
  },
});

describe('parseOwnerBotCallbackQuery', () => {
  it('reads a button press in the presser\'s own private chat', () => {
    expect(parseOwnerBotCallbackQuery(press())).toEqual({
      updateId: 11, callbackQueryId: 'q1', telegramUserId: 4242, chatId: 4242, messageId: 7, privateChat: true, data: 'v1:menu:x',
    });
  });

  it('marks presses outside the presser\'s private chat, so they are answered but not acted on', () => {
    expect(parseOwnerBotCallbackQuery(press({}, { chat: { id: -100123, type: 'supergroup' } }))?.privateChat).toBe(false);
    expect(parseOwnerBotCallbackQuery(press({ from: { id: 5151 } }))?.privateChat).toBe(false);
    expect(parseOwnerBotCallbackQuery(press({}, null))).toMatchObject({ privateChat: false, chatId: null, messageId: null });
    expect(parseOwnerBotCallbackQuery(press({ data: undefined }))?.data).toBeNull();
  });

  it('ignores updates that are not a person\'s button press', () => {
    expect(parseOwnerBotCallbackQuery(null)).toBeNull();
    expect(parseOwnerBotCallbackQuery(privateMessage())).toBeNull();
    expect(parseOwnerBotCallbackQuery(press({ id: '' }))).toBeNull();
    expect(parseOwnerBotCallbackQuery(press({ from: { id: 4242, is_bot: true } }))).toBeNull();
    expect(parseOwnerBotCallbackQuery(press({ from: { id: '4242' } }))).toBeNull();
  });
});
