import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clubMessageToReplyTo } from './clubChat';

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
