import { describe, expect, it } from 'vitest';
import { MAX_HISTORY_MESSAGES, parseAssistantRequest, trimHistory } from './request';

const CLUB_ID = '290c5c33-9dfa-464a-a072-ef5a231f5308';

describe('parseAssistantRequest', () => {
  it('accepts a conversation that ends with a user question', () => {
    const body = {
      clubId: CLUB_ID,
      locale: 'ru',
      messages: [
        { role: 'user', content: 'Привет' },
        { role: 'assistant', content: 'Здравствуйте' },
        { role: 'user', content: 'Сколько прибыли?' },
      ],
    };
    expect(parseAssistantRequest(body)).toEqual(body);
  });

  it('rejects bad clubs, locales, roles and order', () => {
    const user = { role: 'user', content: 'Hi' };
    expect(parseAssistantRequest({ clubId: 'nope', locale: 'en', messages: [user] })).toBeNull();
    expect(parseAssistantRequest({ clubId: CLUB_ID, locale: 'de', messages: [user] })).toBeNull();
    expect(parseAssistantRequest({ clubId: CLUB_ID, locale: 'en', messages: [{ role: 'system', content: 'x' }] })).toBeNull();
    expect(parseAssistantRequest({ clubId: CLUB_ID, locale: 'en', messages: [user, { role: 'assistant', content: 'x' }] })).toBeNull();
    expect(parseAssistantRequest({ clubId: CLUB_ID, locale: 'en', messages: [{ role: 'user', content: '   ' }] })).toBeNull();
    expect(parseAssistantRequest(null)).toBeNull();
  });
});

describe('trimHistory', () => {
  it('keeps the newest messages and starts with a user turn', () => {
    const messages = Array.from({ length: MAX_HISTORY_MESSAGES + 1 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: String(index),
    }));
    const trimmed = trimHistory(messages);
    expect(trimmed[0].role).toBe('user');
    expect(trimmed.at(-1)?.content).toBe(String(MAX_HISTORY_MESSAGES));
    expect(trimmed.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
  });
});
