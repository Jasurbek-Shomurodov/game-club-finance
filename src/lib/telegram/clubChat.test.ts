import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clubMessageToReplyTo, messageToReplyToIn, staffChatId } from './clubChat';

describe('clubMessageToReplyTo', () => {
  const CLUB = 'club-main';
  beforeEach(() => {
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns the stored message id when it is in the club group', () => {
    expect(clubMessageToReplyTo(CLUB, { telegram_chat_id: '-1001', telegram_message_id: 42 })).toBe(42);
    expect(clubMessageToReplyTo(CLUB, { telegram_chat_id: -1001, telegram_message_id: '42' })).toBe(42);
  });

  it('ignores a message stored for another chat, a club without a group, or no message', () => {
    expect(clubMessageToReplyTo(CLUB, { telegram_chat_id: '-1009', telegram_message_id: 42 })).toBeNull();
    expect(clubMessageToReplyTo('other-club', { telegram_chat_id: '-1001', telegram_message_id: 42 })).toBeNull();
    expect(clubMessageToReplyTo(CLUB, { telegram_chat_id: null, telegram_message_id: null })).toBeNull();
    expect(clubMessageToReplyTo(CLUB, { telegram_chat_id: '-1001', telegram_message_id: null })).toBeNull();
    expect(clubMessageToReplyTo(CLUB, { telegram_chat_id: '-1001', telegram_message_id: 'x' })).toBeNull();
    expect(clubMessageToReplyTo(CLUB, null)).toBeNull();
  });
});

describe('staffChatId', () => {
  const CLUB = 'club-pixel';
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns the trimmed staff group of the club\'s target, or null when none is set', () => {
    vi.stubEnv('TELEGRAM_PIXEL_CLUB_ID', CLUB);
    vi.stubEnv('TELEGRAM_PIXEL_CHAT_ID', '-1001');
    vi.stubEnv('TELEGRAM_PIXEL_STAFF_CHAT_ID', ' -1005 ');
    expect(staffChatId(CLUB)).toBe('-1005');
    expect(staffChatId('other-club')).toBeNull();
    vi.stubEnv('TELEGRAM_PIXEL_STAFF_CHAT_ID', '  ');
    expect(staffChatId(CLUB)).toBeNull();
  });
});

describe('messageToReplyToIn', () => {
  it('replies only to a message stored for the chat the notice goes to', () => {
    expect(messageToReplyToIn('-1005', { telegram_chat_id: '-1005', telegram_message_id: 9 })).toBe(9);
    expect(messageToReplyToIn('-1005', { telegram_chat_id: '-1001', telegram_message_id: 9 })).toBeNull();
    expect(messageToReplyToIn(null, { telegram_chat_id: '-1005', telegram_message_id: 9 })).toBeNull();
    expect(messageToReplyToIn('-1005', { telegram_chat_id: '-1005', telegram_message_id: 0 })).toBeNull();
  });
});
